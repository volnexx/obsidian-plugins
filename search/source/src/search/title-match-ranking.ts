export const TitleMatchRank = {
  None: 0,
  Prefix: 1,
  Exact: 2,
} as const

export type TitleMatchRank =
  (typeof TitleMatchRank)[keyof typeof TitleMatchRank]

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

export function getTitleMatchRank(title: string, query: string): TitleMatchRank {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return TitleMatchRank.None

  const normalizedTitle = normalize(title)
  if (normalizedTitle === normalizedQuery) return TitleMatchRank.Exact
  if (normalizedTitle.startsWith(normalizedQuery)) return TitleMatchRank.Prefix

  return TitleMatchRank.None
}

export function compareTitleMatches(
  leftRank: TitleMatchRank,
  leftScore: number,
  rightRank: TitleMatchRank,
  rightScore: number
): number {
  return rightRank - leftRank || rightScore - leftScore
}
