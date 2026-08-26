declare const repositoryIdBrand: unique symbol;
declare const operationIdBrand: unique symbol;
declare const repositoryFamilyIdBrand: unique symbol;

export type RepositoryId<Identity extends string = string> = string & {
  readonly [repositoryIdBrand]: Identity;
};

export type OperationId<Identity extends string = string> = string & {
  readonly [operationIdBrand]: Identity;
};

export type RepositoryFamilyId<Identity extends string = string> = string & {
  readonly [repositoryFamilyIdBrand]: Identity;
};
