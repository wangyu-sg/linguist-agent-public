#!/usr/bin/env python3
"""Managed PaddleOCR JSONL worker.

The Node host owns paths, permissions, process lifetime, and the capability
lock. This worker never downloads a model: both model directories are required
inputs under the verified managed pack.
"""

from __future__ import annotations

import json
import ipaddress
import os
import socket
import sys
from pathlib import Path
from typing import Any


def fail(message: str) -> None:
    raise RuntimeError(message)


def install_local_only_network_guard() -> None:
    """Fail before DNS or socket I/O can leave the local machine.

    Paddle receives complete, locked local model directories. A regression that
    tries an implicit model/font download must therefore become a typed worker
    failure instead of a hidden network fallback.
    """

    original_getaddrinfo = socket.getaddrinfo
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def local_host(host: Any) -> bool:
        if host is None or host in {"", "localhost"}:
            return True
        try:
            return ipaddress.ip_address(str(host).strip("[]")).is_loopback
        except ValueError:
            return False

    def guarded_getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
        if not local_host(host):
            fail(f"Managed OCR blocked an undeclared network lookup: {host}")
        return original_getaddrinfo(host, *args, **kwargs)

    def guarded_connect(instance: socket.socket, address: Any) -> Any:
        if instance.family in {socket.AF_INET, socket.AF_INET6}:
            host = address[0] if isinstance(address, tuple) and address else address
            if not local_host(host):
                fail(f"Managed OCR blocked an undeclared network connection: {host}")
        return original_connect(instance, address)

    def guarded_connect_ex(instance: socket.socket, address: Any) -> int:
        if instance.family in {socket.AF_INET, socket.AF_INET6}:
            host = address[0] if isinstance(address, tuple) and address else address
            if not local_host(host):
                fail(f"Managed OCR blocked an undeclared network connection: {host}")
        return original_connect_ex(instance, address)

    socket.getaddrinfo = guarded_getaddrinfo
    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex


def as_json(value: Any) -> dict[str, Any]:
    candidate = getattr(value, "json", None)
    if callable(candidate):
        candidate = candidate()
    if isinstance(candidate, str):
        candidate = json.loads(candidate)
    if isinstance(candidate, dict):
        return candidate
    if isinstance(value, dict):
        return value
    candidate = getattr(value, "res", None)
    if isinstance(candidate, dict):
        return {"res": candidate}
    fail("PaddleOCR returned an unsupported result shape")


def points(value: Any) -> list[list[float]]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, (list, tuple)):
        return []
    result: list[list[float]] = []
    for point in value:
        if hasattr(point, "tolist"):
            point = point.tolist()
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            result.append([float(point[0]), float(point[1])])
    return result


def page_dimensions(result: Any, source_path: Path, polygons: Any) -> tuple[float, float]:
    if source_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}:
        from PIL import Image
        with Image.open(source_path) as image:
            return float(image.width), float(image.height)
    image_map = getattr(result, "img", None)
    visual = image_map.get("ocr_res_img") if isinstance(image_map, dict) else None
    if visual is not None and hasattr(visual, "size"):
        visual_width, visual_height = visual.size
        all_points = [point for polygon in polygons for point in points(polygon)]
        maximum_x = max((point[0] for point in all_points), default=0)
        # Paddle's OCR result image places source and overlay side by side.
        page_width = visual_width / 2 if visual_width / 2 >= maximum_x else visual_width
        return float(page_width), float(visual_height)
    all_points = [point for polygon in polygons for point in points(polygon)]
    return (
        max((point[0] for point in all_points), default=0),
        max((point[1] for point in all_points), default=0),
    )


def normalize_page(raw: dict[str, Any], page_number: int, result: Any, source_path: Path) -> dict[str, Any]:
    payload = raw.get("res") if isinstance(raw.get("res"), dict) else raw
    polygons = payload.get("dt_polys") or payload.get("rec_polys") or []
    texts = payload.get("rec_texts") or []
    scores = payload.get("rec_scores") or []
    orientations = payload.get("textline_orientation_angles") or []
    width, height = page_dimensions(result, source_path, polygons)
    blocks: list[dict[str, Any]] = []
    for index, text in enumerate(texts):
        polygon = points(polygons[index] if index < len(polygons) else [])
        score = float(scores[index]) if index < len(scores) else 0.0
        orientation_value = float(orientations[index]) if index < len(orientations) else -1.0
        orientation = 180.0 if orientation_value == 1 else orientation_value if orientation_value > 1 else 0.0
        blocks.append({
            "polygon": polygon,
            "text": str(text),
            "confidence": score,
            "orientation": orientation,
        })
    return {"page": page_number, "width": width, "height": height, "orientation": 0, "blocks": blocks}


def handle(request: dict[str, Any]) -> dict[str, Any]:
    source_path = Path(str(request.get("sourcePath") or "")).resolve(strict=True)
    model_root = Path(str(request.get("modelRoot") or "")).resolve(strict=True)
    detection_dir = (model_root / "PP-OCRv5_mobile_det").resolve(strict=True)
    recognition_dir = (model_root / "PP-OCRv6_medium_rec").resolve(strict=True)
    orientation_dir = (model_root / "PP-LCNet_x0_25_textline_ori").resolve(strict=True)
    if model_root not in detection_dir.parents or model_root not in recognition_dir.parents or model_root not in orientation_dir.parents:
        fail("OCR model directory escaped the managed model root")

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    install_local_only_network_guard()
    from paddleocr import PaddleOCR  # Imported only after paths are validated.

    use_orientation = bool(request.get("useOrientation", False))
    engine_options = dict(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_detection_model_dir=str(detection_dir),
        text_recognition_model_name="PP-OCRv6_medium_rec",
        text_recognition_model_dir=str(recognition_dir),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=use_orientation,
    )
    if use_orientation:
        engine_options.update(
            textline_orientation_model_name="PP-LCNet_x0_25_textline_ori",
            textline_orientation_model_dir=str(orientation_dir),
        )
    engine = PaddleOCR(**engine_options)
    results = engine.predict(str(source_path))
    pages = [normalize_page(as_json(result), index + 1, result, source_path) for index, result in enumerate(results)]
    return {
        "ok": True,
        "sourcePath": str(source_path),
        "runtimeVersion": sys.version.split()[0],
        "models": {
            "detection": "PP-OCRv5_mobile_det",
            "recognition": "PP-OCRv6_medium_rec",
            "textlineOrientation": "PP-LCNet_x0_25_textline_ori" if use_orientation else None,
        },
        "pages": pages,
    }


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                fail("Worker request must be a JSON object")
            response = handle(request)
        except Exception as error:  # Host receives typed failure without losing stderr diagnostics.
            response = {"ok": False, "error": str(error), "errorType": type(error).__name__}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
