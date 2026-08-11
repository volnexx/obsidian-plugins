import {
  getSearchPreset,
  SEARCH_PRESET_VERSION,
} from '../settings/search-preset'

describe('Search settings preset', () => {
  it('has a version so it can be applied once to existing Omnisearch data', () => {
    expect(SEARCH_PRESET_VERSION).toBeGreaterThan(0)
  })

  it('uses the requested indexing defaults', () => {
    expect(getSearchPreset()).toMatchObject({
      PDFIndexing: false,
      imagesIndexing: false,
      officeIndexing: false,
      aiImageIndexing: false,
      unsupportedFilesIndexing: 'default',
      displayTitle: '',
      indexedFileTypes: ['txt', 'org', 'csb'],
    })
  })

  it('uses the requested search behavior defaults', () => {
    expect(getSearchPreset()).toMatchObject({
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
    })
  })

  it('uses the requested interface and weighting defaults', () => {
    expect(getSearchPreset()).toMatchObject({
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
      recencyBoost: '1',
    })
  })

  it('uses the requested server, safety, and logging defaults', () => {
    expect(getSearchPreset()).toMatchObject({
      httpApiEnabled: false,
      ignoreDiacritics: true,
      DANGER_forceSaveCache: false,
      verboseLogging: false,
    })
  })

  it('returns fresh arrays for each settings instance', () => {
    const first = getSearchPreset()
    const second = getSearchPreset()

    expect(first.indexedFileTypes).not.toBe(second.indexedFileTypes)
    expect(first.downrankedFoldersFilters).not.toBe(
      second.downrankedFoldersFilters
    )
    expect(first.weightCustomProperties).not.toBe(second.weightCustomProperties)
  })
})
