import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveProjectDiscoveryScope } from './project-discovery-scope'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Project Discovery Scope', () => {
  test('只包含宿主授权的项目根和附件，并把不可用附件显式保留为缺口', () => {
    const root = mkdtempSync(join(tmpdir(), 'linguist-discovery-'))
    temporaryDirectories.push(root)
    const attachedDirectory = join(root, 'references')
    const attachedFile = join(root, 'brief.docx')
    const missingFile = join(root, 'missing.xlsx')
    mkdirSync(attachedDirectory)
    writeFileSync(attachedFile, 'brief')

    const scope = resolveProjectDiscoveryScope({
      session: {
        workspaceId: 'workspace-1',
        linguistProjectId: 'project-1',
        attachedDirectories: [attachedDirectory, root],
        attachedFiles: [attachedFile, missingFile],
      },
      dependencies: {
        getWorkspace: () => ({
          id: 'workspace-1',
          name: 'Workspace',
          slug: 'workspace',
          projectRootPath: root,
          createdAt: 0,
          updatedAt: 0,
        }),
        getProjectFilesPath: () => root,
        getWorkspaceAttachedDirectories: () => [attachedDirectory],
        getWorkspaceAttachedFiles: () => [attachedFile],
        listManagedEvidence: () => [
          { ref: { kind: 'asset', id: 'asset-1' }, version: 'sha-1' },
        ],
      },
    })

    expect(scope.roots.map((item) => item.path)).toEqual([
      realpathSync(root),
      realpathSync(attachedDirectory),
    ])
    expect(scope.files.map((item) => item.path)).toEqual([realpathSync(attachedFile)])
    expect(scope.unavailable).toEqual([
      { kind: 'session-attached-file', name: 'missing.xlsx', reason: 'missing' },
    ])
    expect(scope.managedEvidence).toEqual([
      { ref: { kind: 'asset', id: 'asset-1' }, version: 'sha-1' },
    ])
    expect(scope.hash).toHaveLength(64)
  })
})
