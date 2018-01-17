#!/usr/bin/env node
'use strict';

const log = require('npmlog');
const commander = require('commander');
const hseLib = require('./lib/HueSceneEditor');

const LOG_PREFIX = 'CLI';

log.log(LOG_PREFIX, 'HomeOnNode Hue Scene Helper');

commander
  .version('0.2.0')
  .option('-v, --verbose', 'Verbose output')
  .option('-t, --trial', 'Trial only, don\'t make requests.')
  .option('-r, --recipeFile <filename>', 'Read [recipes.json]', 'recipes.json');

commander
  .command('set <filename>')
  .description('Sets all lights in a scene definition file to their settings.')
  .action(hseLib.setLights);

// commander
//   .command('recipes')
//   .description('Lists all of the possible recipes')
//   .action(() => {
//     readRecipeFile(commander.recipeFile);
//     const keys = Object.keys(recipes);
//     keys.forEach(function(key) {
//       let k = key + '                            ';
//       k = k.substring(0, 20);
//       // TODO
//       // log.log(k, JSON.stringify(recipes[key]));
//     });
//   });

// commander
//   .command('list')
//   .description('Lists all of the current scenes')
//   .action(editor.getScenes)
//   .then((sceneList) => {
//     const keys = Object.keys(sceneList);
//     keys.forEach((key) => {
//       let k = key + '                            ';
//       k = k.substring(0, 16);
//       // TODO
//       // log.info(k, sceneList[key].name);
//     });
//   });

// commander
//   .command('create <filename>')
//   .description('Create a new scene based on the scene file.')
//   .action(editor.createScene);

// commander
//   .command('delete <sceneID>')
//   .description('Delete an existing scene.')
//   .action(editor.deleteScene);

// commander
//   .command('update <filename>')
//   .description('Update an existing scene.')
//   .action(editor.updateScene);

commander.parse(process.argv);
if (commander.args.length === 0) {
  commander.help();
}
