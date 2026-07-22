import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

function classNames(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "small" | "regular";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    disabled,
    loading = false,
    loadingLabel,
    size = "small",
    type = "button",
    variant = "secondary",
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={classNames("la-button", className)}
      data-loading={loading || undefined}
      data-size={size}
      data-variant={variant}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
    >
      {loading ? <span className="la-button__progress" aria-hidden="true" /> : null}
      <span>{loading && loadingLabel !== undefined ? loadingLabel : children}</span>
    </button>
  );
});

export type IconButtonSize = "compact" | "small";
export type IconButtonVariant = "secondary" | "ghost";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  "aria-label": string;
  children: ReactElement;
  pressed?: boolean;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    "aria-label": ariaLabel,
    children,
    className,
    pressed,
    size = "small",
    type = "button",
    variant = "ghost",
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={classNames("la-icon-button", className)}
      data-size={size}
      data-variant={variant}
      aria-label={ariaLabel}
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
});

export type StatusState =
  | "neutral"
  | "info"
  | "running"
  | "waiting"
  | "stopping"
  | "stopped"
  | "complete"
  | "failed";

export interface StatusLabelProps extends Omit<HTMLAttributes<HTMLSpanElement>, "role"> {
  children: ReactNode;
  state?: StatusState;
  icon?: ReactElement;
  live?: boolean;
}

export const StatusLabel = forwardRef<HTMLSpanElement, StatusLabelProps>(function StatusLabel(
  { children, className, icon, live = false, state = "neutral", ...props },
  ref,
) {
  return (
    <span
      {...props}
      ref={ref}
      className={classNames("la-status-label", className)}
      data-state={state}
      role={live ? "status" : undefined}
    >
      {icon ? <span className="la-status-label__icon" aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
    </span>
  );
});

export interface PaneHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 1 | 2 | 3;
}

export const PaneHeader = forwardRef<HTMLElement, PaneHeaderProps>(function PaneHeader(
  {
    actions,
    className,
    description,
    headingLevel = 2,
    title,
    ...props
  },
  ref,
) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";
  return (
    <header {...props} ref={ref} className={classNames("la-pane-header", className)}>
      <div className="la-pane-header__copy">
        <Heading className="la-pane-header__title">{title}</Heading>
        {description !== undefined ? (
          <div className="la-pane-header__description">{description}</div>
        ) : null}
      </div>
      {actions !== undefined ? <div className="la-pane-header__actions">{actions}</div> : null}
    </header>
  );
});
