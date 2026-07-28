import { atom } from 'jotai'

export interface CatResultLocation {
  projectId: string
  segmentId?: string
}

export interface CatResultNavigationRequest extends CatResultLocation {
  revision: number
}

export const catResultNavigationRequestAtom = atom<CatResultNavigationRequest | null>(null)

export const requestCatResultNavigationAtom = atom(
  null,
  (get, set, location: CatResultLocation) => {
    set(catResultNavigationRequestAtom, {
      ...location,
      revision: (get(catResultNavigationRequestAtom)?.revision ?? 0) + 1,
    })
  },
)
