import {
  compareTitleMatches,
  getTitleMatchRank,
  TitleMatchRank,
} from '../search/title-match-ranking'

describe('Title match ranking', () => {
  it('ranks an exact title above a longer prefix match', () => {
    expect(getTitleMatchRank('плагин', 'плагин')).toBe(TitleMatchRank.Exact)
    expect(getTitleMatchRank('плагин активность', 'плагин')).toBe(
      TitleMatchRank.Prefix
    )
  })

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(getTitleMatchRank('  Search  ', 'search')).toBe(TitleMatchRank.Exact)
  })

  it('does not treat a match in the middle of a title as a prefix', () => {
    expect(getTitleMatchRank('менеджер плагинов', 'плагин')).toBe(
      TitleMatchRank.None
    )
  })

  it('keeps exact matches first regardless of their numeric score', () => {
    const results = [
      { title: 'плагин менеджер', score: 100_000 },
      { title: 'мой плагин', score: 1_000_000 },
      { title: 'плагин', score: 1 },
    ]

    results.sort((left, right) =>
      compareTitleMatches(
        getTitleMatchRank(left.title, 'плагин'),
        left.score,
        getTitleMatchRank(right.title, 'плагин'),
        right.score
      )
    )

    expect(results.map(result => result.title)).toEqual([
      'плагин',
      'плагин менеджер',
      'мой плагин',
    ])
  })

  it('uses the numeric score only inside the same title-match level', () => {
    const results = [
      { rank: TitleMatchRank.Prefix, score: 10 },
      { rank: TitleMatchRank.Prefix, score: 20 },
    ]

    results.sort((left, right) =>
      compareTitleMatches(left.rank, left.score, right.rank, right.score)
    )

    expect(results.map(result => result.score)).toEqual([20, 10])
  })
})
