#!/usr/bin/env node

'use strict';

const inquirer = require('inquirer');
const FBHelper = require('./FBHelper');

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

/**
 * Start the app
 */
async function go() {
  const db = await FBHelper.getDB();
  if (!db) {
    return;
  }
  const cmdRef = await db.ref('config/HomeOnNode/commands').once('value');
  const cmds = cmdRef.val();
  let keepRunning = true;
  while (keepRunning) {
    const cmd = await prompt(cmds);
    if (cmd.cmdName === '--EXIT--') {
      keepRunning = false;
    } else {
      await db.ref('commands').push({cmdName: cmd.cmdName});
    }
  }
  process.exit(0);
}

go();
