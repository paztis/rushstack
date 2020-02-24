// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as Webpack from 'webpack';
import * as lodash from 'lodash';

import { Constants } from './utilities/Constants';
import { EntityMarker } from './utilities/EntityMarker';
import { ILocaleElementMap } from './interfaces';
import { LocalizationPlugin, IStringSerialNumberData as IStringData } from './LocalizationPlugin';

interface IReconstructionElement {
  kind: 'static' | 'localized' | 'dynamic';
}

interface IStaticReconstructionElement extends IReconstructionElement {
  kind: 'static';
  staticString: string;
}

interface ILocalizedReconstructionElement extends IReconstructionElement {
  kind: 'localized';
  values: ILocaleElementMap;
  size: number;
  stringName: string;
  locFilePath: string;
}

interface IDynamicReconstructionElement extends IReconstructionElement {
  kind: 'dynamic';
  valueFn: (locale: string | undefined, token: string | undefined) => string;
  size: number;
  token?: string;
}

interface IParseResult {
  issues: string[];
  reconstructionSeries: IReconstructionElement[];
}

interface IReconstructedString {
  source: string;
  size: number;
}

interface ILocalizedReconstructionResult {
  result: Map<string, IReconstructedString>;
  issues: string[];
}

interface INonLocalizedReconstructionResult {
  result: IReconstructedString;
  issues: string[];
}

export interface IProcessAssetOptionsBase {
  plugin: LocalizationPlugin;
  compilation: Webpack.compilation.Compilation;
  assetName: string;
  asset: IAsset;
  chunk: Webpack.compilation.Chunk;
  noStringsLocaleName: string;
}

export interface IProcessNonLocalizedAssetOptions extends IProcessAssetOptionsBase { }

export interface IProcessLocalizedAssetOptions extends IProcessAssetOptionsBase {
  locales: Set<string>;
  fillMissingTranslationStrings: boolean;
  defaultLocale: string;
}

export interface IAsset {
  size(): number;
  source(): string;
}

export interface IProcessAssetResult {
  filename: string;
  asset: IAsset;
}

const PLACEHOLDER_REGEX: RegExp = new RegExp(
  `${Constants.STRING_PLACEHOLDER_PREFIX}_([A-C])(\\+[^+]+\\+)?_(\\d+)`,
  'g'
);

export class AssetProcessor {
  public static processLocalizedAsset(options: IProcessLocalizedAssetOptions): Map<string, IProcessAssetResult> {
    const assetSource: string = options.asset.source();

    const parsedAsset: IParseResult = AssetProcessor._parseStringToReconstructionSequence(
      options.plugin,
      assetSource,
      this._getJsonpFunction(options.chunk, options.noStringsLocaleName)
    );
    const reconstructedAsset: ILocalizedReconstructionResult = AssetProcessor._reconstructLocalized(
      parsedAsset.reconstructionSeries,
      options.locales,
      options.fillMissingTranslationStrings,
      options.defaultLocale,
      options.asset.size()
    );

    const parsedAssetName: IParseResult = AssetProcessor._parseStringToReconstructionSequence(
      options.plugin,
      options.assetName,
      () => { throw new Error('unsupported'); }
    );
    const reconstructedAssetName: ILocalizedReconstructionResult = AssetProcessor._reconstructLocalized(
      parsedAssetName.reconstructionSeries,
      options.locales,
      options.fillMissingTranslationStrings,
      options.defaultLocale,
      options.assetName.length
    );

    const result: Map<string, IProcessAssetResult> = new Map<string, IProcessAssetResult>();
    for (const [locale, { source, size }] of reconstructedAsset.result) {
      const newAsset: IAsset = lodash.clone(options.asset);
      newAsset.source = () => source;
      newAsset.size = () => size;

      result.set(
        locale,
        {
          filename: reconstructedAssetName.result.get(locale)!.source,
          asset: newAsset
        }
      );
    }

    const issues: string[] = [
      ...parsedAsset.issues,
      ...reconstructedAsset.issues,
      ...parsedAssetName.issues,
      ...reconstructedAssetName.issues
    ];

    if (issues.length > 0) {
      options.compilation.errors.push(Error(
        `localization:\n${issues.map((issue) => `  ${issue}`).join('\n')}`
      ));
    }

    return result;
  }

  public static processNonLocalizedAsset(options: IProcessNonLocalizedAssetOptions): IProcessAssetResult {
    const assetSource: string = options.asset.source();

    const parsedAsset: IParseResult = AssetProcessor._parseStringToReconstructionSequence(
      options.plugin,
      assetSource,
      this._getJsonpFunction(options.chunk, options.noStringsLocaleName)
    );
    const reconstructedAsset: INonLocalizedReconstructionResult = AssetProcessor._reconstructNonLocalized(
      parsedAsset.reconstructionSeries,
      options.asset.size(),
      options.noStringsLocaleName
    );

    const parsedAssetName: IParseResult = AssetProcessor._parseStringToReconstructionSequence(
      options.plugin,
      options.assetName,
      () => { throw new Error('unsupported'); }
    );
    const reconstructedAssetName: INonLocalizedReconstructionResult = AssetProcessor._reconstructNonLocalized(
      parsedAssetName.reconstructionSeries,
      options.assetName.length,
      options.noStringsLocaleName
    );

    const issues: string[] = [
      ...parsedAsset.issues,
      ...reconstructedAsset.issues,
      ...parsedAssetName.issues,
      ...reconstructedAssetName.issues
    ];

    if (issues.length > 0) {
      options.compilation.errors.push(Error(
        `localization:\n${issues.map((issue) => `  ${issue}`).join('\n')}`
      ));
    }

    const newAsset: IAsset = lodash.clone(options.asset);
    newAsset.source = () => reconstructedAsset.result.source;
    newAsset.size = () => reconstructedAsset.result.size;
    return {
      filename: reconstructedAssetName.result.source,
      asset: newAsset
    };
  }

  private static _reconstructLocalized(
    reconstructionSeries: IReconstructionElement[],
    locales: Set<string>,
    fillMissingTranslationStrings: boolean,
    defaultLocale: string,
    initialSize: number
  ): ILocalizedReconstructionResult {
    const localizedResults: Map<string, IReconstructedString> = new Map<string, IReconstructedString>();
    const issues: string[] = [];

    for (const locale of locales) {
      const reconstruction: string[] = [];

      let sizeDiff: number = 0;
      for (const element of reconstructionSeries) {
        switch (element.kind) {
          case 'static': {
            reconstruction.push((element as IStaticReconstructionElement).staticString);
            break;
          }

          case 'localized': {
            const localizedElement: ILocalizedReconstructionElement = element as ILocalizedReconstructionElement;
            let newValue: string | undefined = localizedElement.values[locale];
            if (!newValue) {
              if (fillMissingTranslationStrings) {
                newValue = localizedElement.values[defaultLocale];
              } else {
                issues.push(
                  `The string "${localizedElement.stringName}" in "${localizedElement.locFilePath}" is missing in ` +
                  `the locale ${locale}`
                );

                newValue = '-- MISSING STRING --';
              }
            }

            // Replace the quotemark character with a unicode-escaped character
            newValue = newValue.replace(/\"/g, '\\u0022');

            // Replace the apostrophe character with a unicode-escaped character
            newValue = newValue.replace(/\'/g, '\\u0027');

            reconstruction.push(newValue);
            sizeDiff += (newValue.length - localizedElement.size);
            break;
          }

          case 'dynamic': {
            const dynamicElement: IDynamicReconstructionElement = element as IDynamicReconstructionElement;
            const newValue: string = dynamicElement.valueFn(locale, dynamicElement.token);
            reconstruction.push(newValue);
            sizeDiff += (newValue.length - dynamicElement.size);
            break;
          }
        }
      }

      const newAssetSource: string = reconstruction.join('');
      localizedResults.set(
        locale,
        {
          source: newAssetSource,
          size: initialSize + sizeDiff
        }
      );
    }

    return {
      issues,
      result: localizedResults
    };
  }

  private static _reconstructNonLocalized(
    reconstructionSeries: IReconstructionElement[],
    initialSize: number,
    noStringsLocaleName: string
  ): INonLocalizedReconstructionResult {
    const issues: string[] = [];

    const reconstruction: string[] = [];

    let sizeDiff: number = 0;
    for (const element of reconstructionSeries) {
      switch (element.kind) {
        case 'static': {
          reconstruction.push((element as IStaticReconstructionElement).staticString);
          break;
        }

        case 'localized': {
          const localizedElement: ILocalizedReconstructionElement = element as ILocalizedReconstructionElement;
          issues.push(
            `The string "${localizedElement.stringName}" in "${localizedElement.locFilePath}" appeared in an asset ` +
            'that is not expected to contain localized resources.'
          );

          const newValue: string = '-- NOT EXPECTED TO BE LOCALIZED --';
          reconstruction.push(newValue);
          sizeDiff += (newValue.length - localizedElement.size);
          break;
        }

        case 'dynamic': {
          const dynamicElement: IDynamicReconstructionElement = element as IDynamicReconstructionElement;
          const newValue: string = dynamicElement.valueFn(noStringsLocaleName, dynamicElement.token);
          reconstruction.push(newValue);
          sizeDiff += (newValue.length - dynamicElement.size);
          break;
        }
      }
    }

    const newAssetSource: string = reconstruction.join('');
    return {
      issues,
      result: {
        source: newAssetSource,
        size: initialSize + sizeDiff
      }
    };
  }

  private static _parseStringToReconstructionSequence(
    plugin: LocalizationPlugin,
    source: string,
    jsonpFunction: (locale: string, chunkIdToken: string) => string
  ): IParseResult {
    const issues: string[] = [];
    const reconstructionSeries: IReconstructionElement[] = [];

    let lastIndex: number = 0;
    let regexResult: RegExpExecArray | null;
    while (regexResult = PLACEHOLDER_REGEX.exec(source)) { // eslint-disable-line no-cond-assign
      const staticElement: IStaticReconstructionElement = {
        kind: 'static',
        staticString: source.substring(lastIndex, regexResult.index)
      };
      reconstructionSeries.push(staticElement);

      const [placeholder, elementLabel, token, placeholderSerialNumber] = regexResult;

      let localizedReconstructionElement: IReconstructionElement;
      switch (elementLabel) {
        case Constants.STRING_PLACEHOLDER_LABEL: {
          const stringData: IStringData | undefined = plugin.getDataForSerialNumber(placeholderSerialNumber);
          if (!stringData) {
            issues.push(`Missing placeholder ${placeholder}`);
            const brokenLocalizedElement: IStaticReconstructionElement = {
              kind: 'static',
              staticString: placeholder
            };
            localizedReconstructionElement = brokenLocalizedElement;
          } else {
            const localizedElement: ILocalizedReconstructionElement = {
              kind: 'localized',
              values: stringData.values,
              size: placeholder.length,
              locFilePath: stringData.locFilePath,
              stringName: stringData.stringName,
            };
            localizedReconstructionElement = localizedElement;
          }
          break;
        }

        case Constants.LOCALE_NAME_PLACEHOLDER_LABEL: {
          const dynamicElement: IDynamicReconstructionElement = {
            kind: 'dynamic',
            valueFn: (locale: string) => locale,
            size: placeholder.length
          };
          localizedReconstructionElement = dynamicElement;
          break;
        }

        case Constants.JSONP_PLACEHOLDER_LABEL: {
          const dynamicElement: IDynamicReconstructionElement = {
            kind: 'dynamic',
            valueFn: jsonpFunction,
            size: placeholder.length,
            token: token.substring(1, token.length - 1)
          };
          localizedReconstructionElement = dynamicElement;
          break;
        }

        default:{
          throw new Error(`Unexpected label ${elementLabel}`);
        }
      }

      reconstructionSeries.push(localizedReconstructionElement);
      lastIndex = regexResult.index + placeholder.length;
    }

    const lastElement: IStaticReconstructionElement = {
      kind: 'static',
      staticString: source.substr(lastIndex)
    };
    reconstructionSeries.push(lastElement);

    return {
      issues,
      reconstructionSeries
    };
  }

  private static _getJsonpFunction(
    chunk: Webpack.compilation.Chunk,
    noStringsLocaleName: string
  ): (locale: string, chunkIdToken: string | undefined) => string {
    const idsWithStrings: Set<string> = new Set<string>();
    const idsWithoutStrings: Set<string> = new Set<string>();

    const asyncChunks: Set<Webpack.compilation.Chunk> = chunk.getAllAsyncChunks();
    for (const asyncChunk of asyncChunks) {
      if (EntityMarker.getMark(asyncChunk)) {
        idsWithStrings.add(asyncChunk.id);
      } else {
        idsWithoutStrings.add(asyncChunk.id);
      }
    }

    if (idsWithStrings.size === 0) {
      return () => JSON.stringify(noStringsLocaleName);
    } else if (idsWithoutStrings.size === 0) {
      return (locale: string) => JSON.stringify(locale);
    } else {
      // Generate an array [<locale>, <nostrings locale>] and an object that is used as an indexer into that
      // object that maps chunk IDs to 0s for chunks with localized strings and 1s for chunks without localized
      // strings
      //
      // This can be improved in the future. We can maybe sort the chunks such that the chunks below a certain ID
      // number are localized and the those above are not.
      const chunkMapping: { [chunkId: string]: number } = {};
      for (const idWithStrings of idsWithStrings) {
        chunkMapping[idWithStrings] = 0;
      }

      for (const idWithoutStrings of idsWithoutStrings) {
        chunkMapping[idWithoutStrings] = 1;
      }

      return (locale: string, chunkIdToken: string) => {
        if (!locale) {
          throw new Error('Missing locale name.');
        }

        return `(${JSON.stringify([locale, noStringsLocaleName])})[${JSON.stringify(chunkMapping)}[${chunkIdToken}]]`;
      }
    }
  }
}
