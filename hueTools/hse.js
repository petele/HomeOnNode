#!/usr/bin/env node
'use strict';

/* eslint no-console: "off", require-jsdoc: "off" */

const util = require('util');
const chalk = require('chalk');
const glob = require('globule');
const commander = require('commander');
const hseLib = require('./lib/HueSceneEditor');

console.log(chalk.bold('HomeOnNode Hue Scene Helper'));

const DELAY_BETWEEN_EXTRA = 60;
const DELAY_BETWEEN_REQUESTS = 350;
const DELAY_BETWEEN_ACTIONS = 1500;

const UTIL_OPTS = {
  colors: true,
  maxArrayLength: 20,
  breakLength: 1000,
}

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
      const k = chalk.cyan(key.padEnd(16, ' '));
      console.log(k, util.inspect(recipes[key].hue, UTIL_OPTS));
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
    return hseLib.activateScene(sceneID)
      .then((results) => {
        hseLib.printResults(results);
      });
  });

commander
  .command('delete <sceneID>')
  .description('Delete an existing scene.')
  .action((sceneID) => {
    return hseLib.deleteScene(sceneID)
      .then((results) => {
        hseLib.printResults(results);
      });
  });

commander
  .command('set <filename>')
  .description('Sets all lights in a scene definition file to their settings.')
  .action((filename) => {
    return makeScenes([filename]);
  });

commander
  .command('update <filename>')
  .description('Update an existing scene.')
  .action((filename) => {
    return makeScenes([filename], true, false);
  });

commander
  .command('folder <folder>')
  .description('Set scenes from all files in folder.')
  .action((folder) => {
    const files = glob.find('*.json', {prefixBase: true, srcBase: folder});
    return makeScenes(files, true, true);
  });

function allOffAndWait() {
  return hseLib.allOff()
    .then(() => {
      console.log(' Waiting for lights to catch up...');
      return hseLib.wait(DELAY_BETWEEN_ACTIONS);
    });
}

async function setScene(sceneObj) {
  let lightList = {};
  console.log('setScene', chalk.cyan(sceneObj.sceneName));
  const lightsInScene = {};
  if (sceneObj.scenes) {
    for (let i = 0; i < sceneObj.scenes.length; i++) {
      const filename = sceneObj.scenes[i];
      const subSceneObj = hseLib.readJSONFile(filename);
      const lights = await setScene(subSceneObj);
      lightList = Object.assign(lightList, lights);
      await hseLib.wait(DELAY_BETWEEN_REQUESTS);
    }
  }
  if (sceneObj.lights) {
    let hasErrors = false;
    for (let i = 0; i < sceneObj.lights.length; i++) {
      const light = sceneObj.lights[i];
      const r = await hseLib.setLight(light);
      if (hseLib.printResults(r, false)) {
        hasErrors = true;
      }
      await hseLib.wait(DELAY_BETWEEN_REQUESTS);
      lightList[light.lightId] = true;
    }
    if (hasErrors) {
      throw new Error('Unable to set lights.');
    }
    const check = chalk.green('✔');
    const numLights = sceneObj.lights.length;
    const delay = DELAY_BETWEEN_EXTRA * numLights;
    console.log(' ', `${check} Set ${chalk.cyan(numLights)} lights, waiting ${delay}ms`);
    await hseLib.wait(delay);
  }
  return lightList;
}

async function makeScenes(files, save, startOff) {
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    console.log('Reading: ', chalk.cyan(filename));
    const sceneObj = hseLib.readJSONFile(filename);
    if (startOff) {
      await allOffAndWait();
    }
    await hseLib.wait(DELAY_BETWEEN_ACTIONS);
    const lightList = await setScene(sceneObj);
    const lights = Object.keys(lightList);
    if (save) {
      await hseLib.wait(DELAY_BETWEEN_ACTIONS / 2);
      if (sceneObj.sceneId) {
        const results = await hseLib.updateScene(sceneObj, lights);
        hseLib.printResults(results, true);
      } else {
        const results = await hseLib.createScene(sceneObj, lights);
        if (results && results[0] && results[0].success) {
          sceneObj.sceneId = results[0].success.id;
          hseLib.saveJSONFile(filename, sceneObj);
        }
        hseLib.printResults(results, true);
      }
    }
    if (i + 1 < files.length) {
      console.log('');
      await hseLib.wait(DELAY_BETWEEN_ACTIONS);
    }
  }
}

commander.parse(process.argv);
if (commander.args.length === 0) {
  commander.help();
}


process.on('unhandledRejection', (reason, p) => {
  console.log('An unhandled promise rejection occured.', reason);
});
