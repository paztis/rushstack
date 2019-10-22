// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AstModule } from './AstModule';

export enum AstImportInternalKind {
  // /**
  //  * An import statement such as `import X from "y";`.
  //  */
  // DefaultImport,

  // /**
  //  * An import statement such as `import { X } from "y";`.
  //  */
  // NamedImport,

  /**
   * An import statement such as `import * as x from "y";`.
   */
  StarImport,

  /**
   * An import statement such as `import x = require("y");`.
   */
  EqualsImport
}

export interface IAstImportInternalOptions {
  readonly importKind: AstImportInternalKind;
  readonly astModule: AstModule;
  readonly exportName: string;
}

/**
 * For a symbol that was imported from an external package, this tracks the import
 * statement that was used to reach it.
 */
export class AstImportInternal {
  public analyzed: boolean = false;

  public readonly importKind: AstImportInternalKind;

  public readonly astModule: AstModule;

  /**
   * The name of the symbol being imported.
   *
   * @remarks
   *
   * The name depends on the type of import:
   *
   * ```ts
   * // For AstImportKind.DefaultImport style, exportName would be "X" in this example:
   * import X from "y";
   *
   * // For AstImportKind.NamedImport style, exportName would be "X" in this example:
   * import { X } from "y";
   *
   * // For AstImportKind.StarImport style, exportName would be "x" in this example:
   * import * as x from "y";
   *
   * // For AstImportKind.EqualsImport style, exportName would be "x" in this example:
   * import x = require("y");
   * ```
   */
  public readonly exportName: string;

  public constructor(options: IAstImportInternalOptions) {
    this.importKind = options.importKind;
    this.astModule = options.astModule;
    this.exportName = options.exportName;
  }

  public get localName(): string {
    return this.exportName;
  }
}
