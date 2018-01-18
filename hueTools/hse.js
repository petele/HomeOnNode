#!/usr/bin/env node
'use strict';

/* eslint no-console: "off", require-jsdoc: "off" */

const chalk = require('chalk');
const glob = require('globule');
const commander = require('commander');
const hseLib = require('./lib/HueSceneEditor');

console.log(chalk.bold('HomeOnNode Hue Scene Helper'));

commander
  .version('0.8.0')
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
  .command('activate <sceneID>')
  .description('Activates the specified scene.')
  .action((sceneID) => {
    return hseLib.activateScene(sceneID);
  });

commander
  .command('set <filename>')
  .description('Sets all lights in a scene definition file to their settings.')
  .action((filename) => {
    const sceneObj = hseLib.readJSONFile(filename);
    return hseLib.setLights(sceneObj.lights);
  });

commander
  .command('create <filename>')
  .description('Create a new scene based on the scene file.')
  .action(createScene);

function createScene(filename) {
  const sceneObj = hseLib.readJSONFile(filename);
  if (sceneObj.sceneId) {
    throw new Error('sceneId already specified.');
  }
  return hseLib.setLights(sceneObj.lights)
    .then(() => {
      return hseLib.createScene(sceneObj);
    })
    .then((id) => {
      sceneObj.sceneId = id;
      hseLib.saveJSONFile(filename, sceneObj);
    });
}

commander
  .command('update <filename>')
  .description('Update an existing scene.')
  .action(updateScene);

async function updateScene(filename) {
  console.log(chalk.cyan(filename));
  const sceneObj = hseLib.readJSONFile(filename);
  if (!sceneObj.sceneId) {
    throw new Error('sceneId is not exist specified.');
  }
  // if (sceneObj.scenes) {
  //   for (let i = 0; i < sceneObj.scenes.length; i++) {
  //     const f = sceneObj.scenes[i];
  //     await updateScene(f);
  //   }
  // }
  return hseLib.setLights(sceneObj.lights)
    .then(() => {
      return hseLib.wait(3500);
    })
    .then(() => {
      return hseLib.updateScene(sceneObj);
    });
}

commander
  .command('delete <sceneID>')
  .description('Delete an existing scene.')
  .action((sceneID) => {
    return hseLib.deleteScene(sceneID);
  });

commander
  .command('folder <folder>')
  .description('Set scenes from all files in folder.')
  .action((folder) => {
    const files = glob.find('*.json', {prefixBase: true, srcBase: folder});
    return folders(files);
  });

async function folders(files) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    await hseLib.allOff();
    await hseLib.wait(1500);
    await updateScene(file);
    await hseLib.wait(500);
  }
}

commander.parse(process.argv);
if (commander.args.length === 0) {
  commander.help();
}


process.on('unhandledRejection', (reason, p) => {
  console.log('An unhandled promise rejection occured.', reason);
});
