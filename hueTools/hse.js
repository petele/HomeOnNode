#!/usr/bin/env node
'use strict';

/* eslint no-console: "off", require-jsdoc: "off" */

const chalk = require('chalk');
const commander = require('commander');
const hseLib = require('./lib/HueSceneEditor');

console.log(chalk.bold('HomeOnNode Hue Scene Helper'));

function printResult(results) {
  console.log(results);
}

commander
  .version('0.2.0')
  .option('-v, --verbose', 'Verbose output')
  .option('-t, --trial', 'Trial only, don\'t make requests.')
  .option('-r, --recipeFile <filename>', 'Read [recipes.json]', 'recipes.json');

commander
  .command('recipes')
  .description('Lists all of the possible recipes')
  .action(() => {
    const recipes = hseLib.getRecipes();
    const keys = Object.keys(recipes);
    keys.forEach(function(key) {
      const k = chalk.cyan(key.padEnd(20, ' '));
      console.log(k, JSON.stringify(recipes[key].hue));
    });
  });

commander
  .command('list')
  .description('Lists all of the current scenes')
  .action(() => {
    hseLib.listScenes()
      .then((scenes) => {
        const keys = Object.keys(scenes);
        keys.forEach(function(key) {
          const k = chalk.cyan(key.padEnd(20, ' '));
          console.log(k, scenes[key].name);
        });
      });
  });

commander
  .command('test')
  .description('Activates the specified scene.')
  .action(() => {
    return hseLib.test().then(printResult);
  });

commander
  .command('activate <sceneID>')
  .description('Activates the specified scene.')
  .action((sceneID) => {
    return hseLib.activateScene(sceneID).then(printResult);
  });

commander
  .command('set <filename>')
  .description('Sets all lights in a scene definition file to their settings.')
  .action((filename) => {
    return hseLib.setLights(filename).then(printResult);
  });

commander
  .command('create <filename>')
  .description('Create a new scene based on the scene file.')
  .action((filename) => {
    return hseLib.createScene(filename)
      .then(printResult)
      .catch(printResult);
  });

commander
  .command('update <filename>')
  .description('Update an existing scene.')
  .action((filename) => {
    return hseLib.updateScene(filename)
      .then(printResult)
      .catch(printResult);
  });

commander
  .command('delete <sceneID>')
  .description('Delete an existing scene.')
  .action((sceneID) => {
    return hseLib.deleteScene(sceneID).then(printResult);
  });

commander.parse(process.argv);
if (commander.args.length === 0) {
  commander.help();
}


process.on('unhandledRejection', (reason, p) => {
  console.log('An unhandled promise rejection occured.', reason);
});
