// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';

import {
  JsonFile,
  JsonSchema,
  FileSystem
} from '@microsoft/node-core-library';

import { RushConstants } from '../logic/RushConstants';

import {
  CommandJson,
  ICommandLineJson,
  ParameterJson
} from './CommandLineJson';

/**
 * Custom Commands and Options for the Rush Command Line
 */
export class CommandLineConfiguration {
  private static _jsonSchema: JsonSchema = JsonSchema.fromFile(
    path.join(__dirname, '../schemas/command-line.schema.json')
  );

  public readonly commands: CommandJson[] = [];
  public readonly parameters: ParameterJson[] = [];

  public static readonly defaultBuildCommandJson: CommandJson = {
    commandKind: RushConstants.bulkCommandKind,
    name: RushConstants.buildCommandName,
    summary: 'Build all projects that haven\'t been built, or have changed since they were last built.',
    description: 'This command is similar to "rush rebuild", except that "rush build" performs'
    + ' an incremental build. In other words, it only builds projects whose source files have changed'
    + ' since the last successful build. The analysis requires a Git working tree, and only considers'
    + ' source files that are tracked by Git and whose path is under the project folder. (For more details'
    + ' about this algorithm, see the documentation for the "package-deps-hash" NPM package.) The incremental'
    + ' build state is tracked in a per-project folder called ".rush/temp" which should NOT be added to Git. The'
    + ' build command is tracked by the "arguments" field in the "package-deps_build.json" file contained'
    + ' therein; a full rebuild is forced whenever the command has changed (e.g. "--production" or not).',
    enableParallelism: true,
    ignoreMissingScript: false,
    ignoreDependencyOrder: false,
    incremental: true,
    allowWarningsInSuccessfulBuild: false,
    safeForSimultaneousRushProcesses: false
  };

  public static readonly defaultRebuildCommandJson: CommandJson = {
    commandKind: RushConstants.bulkCommandKind,
    name: RushConstants.rebuildCommandName,
    summary: 'Clean and rebuild the entire set of projects',
    description: 'This command assumes that the package.json file for each project contains'
    + ' a "scripts" entry for "npm run build" that performs a full clean build.'
    + ' Rush invokes this script to build each project that is registered in rush.json.'
    + ' Projects are built in parallel where possible, but always respecting the dependency'
    + ' graph for locally linked projects.  The number of simultaneous processes will be'
    + ' based on the number of machine cores unless overridden by the --parallelism flag.'
    + ' (For an incremental build, see "rush build" instead of "rush rebuild".)',
    enableParallelism: true,
    ignoreMissingScript: false,
    ignoreDependencyOrder: false,
    incremental: false,
    allowWarningsInSuccessfulBuild: false,
    safeForSimultaneousRushProcesses: false
  };

  /**
   * Use CommandLineConfiguration.loadFromFile()
   */
  private constructor(commandLineJson: ICommandLineJson | undefined) {
    if (commandLineJson) {
      if (commandLineJson.commands) {
        for (const command of commandLineJson.commands) {
          this.commands.push(command);
        }
      }

      if (commandLineJson.parameters) {
        for (const parameter of commandLineJson.parameters) {
          this.parameters.push(parameter);

          // Do some basic validation
          switch (parameter.parameterKind) {
            case 'choice':
              const alternativeNames: string[] = parameter.alternatives.map(x => x.name);

              if (parameter.defaultValue && alternativeNames.indexOf(parameter.defaultValue) < 0) {
                throw new Error(`In ${RushConstants.commandLineFilename}, the parameter "${parameter.longName}",`
                  + ` specifies a default value "${parameter.defaultValue}"`
                  + ` which is not one of the defined alternatives: "${alternativeNames.toString()}"`);
              }
              break;
          }
        }
      }
    }
  }

  /**
   * Loads the configuration from the specified file and applies any omitted default build
   * settings.  If the file does not exist, then an empty default instance is returned.
   * If the file contains errors, then an exception is thrown.
   */
  public static loadFromFileOrDefault(jsonFilename: string): CommandLineConfiguration {
    let commandLineJson: ICommandLineJson | undefined = undefined;
    if (FileSystem.exists(jsonFilename)) {
      commandLineJson = JsonFile.load(jsonFilename);

      // merge commands specified in command-line.json and default (re)build settings
      // Ensure both build commands are included and preserve any other commands specified
      if (commandLineJson && commandLineJson.commands) {
        for (let i: number = 0; i < commandLineJson.commands.length; i++) {
          const command: CommandJson = commandLineJson.commands[i];

          // Determine if we have a set of default parameters
          let commandDefaultDefinition: CommandJson | {} = {};
          switch (command.commandKind) {
            case RushConstants.bulkCommandKind: {
              switch (command.name) {
                case RushConstants.buildCommandName: {
                  commandDefaultDefinition = CommandLineConfiguration.defaultBuildCommandJson
                  break;
                }

                case RushConstants.rebuildCommandName: {
                  commandDefaultDefinition = CommandLineConfiguration.defaultRebuildCommandJson;
                  break;
                }
              }
              break;
            }
          }

          // Merge the default parameters into the repo-specified parameters
          commandLineJson.commands[i] = {
            ...commandDefaultDefinition,
            ...command
          }
        }

        CommandLineConfiguration._jsonSchema.validateObject(commandLineJson, jsonFilename);
      }
    }

    return new CommandLineConfiguration(commandLineJson);
  }
}
