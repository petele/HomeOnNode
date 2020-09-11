#!/usr/bin/env node

'use strict';

/* node14_ready */

const inquirer = require('inquirer');
const FBHelper = require('./FBHelper');

/**
 * Start the app
 */
async function go() {
  const fbRootRef = await FBHelper.getRootRef(30 * 1000);
  const commandsRef = await fbRootRef.child('config/HomeOnNode/commands');
  const sendCommandRef = await fbRootRef.child('commands');

  const snapshot = await commandsRef.once('value');
  const cmds = snapshot.val();
  let keepRunning = true;
  while (keepRunning) {
    const cmd = await prompt(cmds);
    if (cmd.cmdName === '--EXIT--') {
      keepRunning = false;
    } else {
      await sendCommandRef.push({cmdName: cmd.cmdName});
    }
  }
  process.exit(0);
}

/**
 * Shows the prompt with a list of commands
 *
 * @param {Array} commands
 * @return {Promise<Object>} Response
 */
function prompt(commands) {
  const choices = [];
  choices.push({name: 'Exit', value: '--EXIT--'});
  choices.push({name: 'Manual Entry', value: '--MANUAL--'});
  choices.push(new inquirer.Separator());
  Object.keys(commands).forEach((key) => {
    const command = commands[key];
    const item = {};
    if (command.label) {
      item.name = `${key} - ${command.label} [${command.kind}]`;
    } else {
      item.name = `${key} [${command.kind}]`;
    }
    item.value = key;
    choices.push(item);
  });
  choices.push(new inquirer.Separator());
  const qCommands = {
    type: 'list',
    name: 'cmdName',
    message: 'What command do you want to run?',
    paginated: true,
    choices: choices,
    pageSize: 20,
  };
  const qManualInput = {
    type: 'input',
    name: 'cmd',
    message: 'Manual command:',
    validate: function(input) {
      if (input === '') {
        return true;
      }
      try {
        JSON.parse(input);
        return true;
      } catch (ex) {
        return `Requires a valid JSON string: ${ex.message}`;
      }
    },
    when: function(answers) {
      return answers.cmdName === '--MANUAL--';
    },
  };
  return inquirer.prompt([qCommands, qManualInput]);
}


go();
