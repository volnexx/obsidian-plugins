import type { OmnisearchSettings } from './utils'

export const SEARCH_PRESET_VERSION = 1

export function getSearchPreset(): Partial<OmnisearchSettings> {
  return {
    PDFIndexing: false,
    imagesIndexing: false,
    officeIndexing: false,
    aiImageIndexing: false,
    unsupportedFilesIndexing: 'default',
    displayTitle: '',
    indexedFileTypes: ['txt', 'org', 'csb'],

    useCache: true,
    showPreviousQueryResults: true,
    hideExcluded: false,
    downrankedFoldersFilters: [],
    splitCamelCase: true,
    simpleSearch: false,
    tokenizeUrls: false,
    openInNewPane: true,
    vimLikeNavigationShortcut: false,
    fuzziness: '1',

    ribbonIcon: false,
    showExcerpt: false,
    maxEmbeds: 3,
    renderLineReturnInExcerpts: true,
    showCreateButton: false,
    highlight: true,

    weightBasename: 10,
    weightDirectory: 1,
    weightUnmarkedTags: 2,
    weightCustomProperties: [],
    recencyBoost: '1' as OmnisearchSettings['recencyBoost'],

    httpApiEnabled: false,

    ignoreDiacritics: true,
    DANGER_forceSaveCache: false,

    verboseLogging: false,
  }
}
