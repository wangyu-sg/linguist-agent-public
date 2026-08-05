/**
 * Voice profiles repository (PB-095, schema v6): per-speaker voice rows
 * (语域/人称/语气标记/禁忌). Ids are content-derived per (project,
 * speaker, textType) 的 Stable ID v2——同一 speaker+textType 重复创建
 * 幂等返回既有行，编辑走显式 id 的 upsert 路径。
 */

import { deriveStableIdV2 } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import {
  voiceProfileFromRow,
  type VoiceProfile,
  type VoiceProfileRow,
} from './rows'

export interface VoiceProfileInput {
  speaker: string
  textType?: string
  register?: string
  person?: string
  toneMarkers?: string[]
  taboos?: string[]
  notes?: string
  updatedBy?: string
}

export interface VoiceProfileUpsertInput extends VoiceProfileInput {
  /** 缺省为创建；给定时只能更新该项目的现有记录。 */
  id?: string
}

export interface VoiceProfileSearch {
  /** Case-insensitive literal substring matched against speaker OR notes. */
  query?: string
  textType?: string
  limit?: number
  offset?: number
}

function stableId(projectId: string, input: VoiceProfileInput): string {
  return deriveStableIdV2('vpr', [projectId, input.speaker, input.textType ?? null])
}

/** Escape LIKE wildcards so query is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function buildWhere(projectId: string, filter: VoiceProfileSearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.query !== undefined) {
    clauses.push("(speaker LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')")
    const pattern = likePattern(filter.query)
    params.push(pattern, pattern)
  }
  if (filter.textType !== undefined) {
    clauses.push('text_type = ?')
    params.push(filter.textType)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

export class VoiceProfilesRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  upsert(input: VoiceProfileUpsertInput): VoiceProfile {
    return this.db.transaction(`upsert voice profile ${input.id ?? input.speaker}`, () => {
      if (input.id !== undefined) {
        const existing = this.db.db
          .prepare('SELECT id FROM voice_profiles WHERE id = ? AND project_id = ?')
          .get(input.id, this.projectId)
        if (existing === undefined) throw new StoreNotFoundError('voice profile', input.id)
        this.db.db
          .prepare(
            `UPDATE voice_profiles
             SET speaker = ?, text_type = ?, register = ?, person = ?, tone_markers = ?,
                 taboos = ?, notes = ?, updated_at = ?, updated_by = ?
             WHERE id = ? AND project_id = ?`,
          )
          .run(
            input.speaker,
            input.textType ?? null,
            input.register ?? null,
            input.person ?? null,
            input.toneMarkers !== undefined ? JSON.stringify(input.toneMarkers) : null,
            input.taboos !== undefined ? JSON.stringify(input.taboos) : null,
            input.notes ?? null,
            this.now(),
            input.updatedBy ?? null,
            input.id,
            this.projectId,
          )
        return this.get(input.id) as VoiceProfile
      }

      const id = stableId(this.projectId, input)
      const existing = this.db.db
        .prepare('SELECT * FROM voice_profiles WHERE id = ?')
        .get(id) as VoiceProfileRow | undefined
      if (existing !== undefined) {
        if (existing.project_id !== this.projectId || existing.speaker !== input.speaker) {
          throw new Error(`Voice profile id collision: ${id}`)
        }
        return voiceProfileFromRow(existing)
      }
      this.db.db
        .prepare(
          `INSERT INTO voice_profiles
           (id, project_id, speaker, text_type, register, person, tone_markers, taboos,
            notes, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.projectId,
          input.speaker,
          input.textType ?? null,
          input.register ?? null,
          input.person ?? null,
          input.toneMarkers !== undefined ? JSON.stringify(input.toneMarkers) : null,
          input.taboos !== undefined ? JSON.stringify(input.taboos) : null,
          input.notes ?? null,
          this.now(),
          input.updatedBy ?? null,
        )
      return this.get(id) as VoiceProfile
    })
  }

  get(id: string): VoiceProfile | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM voice_profiles WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as VoiceProfileRow | undefined
    return row === undefined ? undefined : voiceProfileFromRow(row)
  }

  list(filter: VoiceProfileSearch = {}): VoiceProfile[] {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM voice_profiles ${where} ORDER BY speaker, updated_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as VoiceProfileRow[]
    return rows.map(voiceProfileFromRow)
  }

  count(filter: Omit<VoiceProfileSearch, 'limit' | 'offset'> = {}): number {
    const { where, params } = buildWhere(this.projectId, filter)
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM voice_profiles ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  delete(id: string): void {
    this.db.transaction(`delete voice profile ${id}`, () => {
      const result = this.db.db
        .prepare('DELETE FROM voice_profiles WHERE id = ? AND project_id = ?')
        .run(id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('voice profile', id)
    })
  }
}
