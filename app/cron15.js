/* globals home */

'use strict';

const cronJob = function() {
  if (home.state.systemState === 'AWAY') {
    home.executeCommandByName('RUN_ON_AWAY', null, 'AWAY_TIMER');
  }
};

cronJob();
