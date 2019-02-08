/* globals _home */

'use strict';

const cronJob = function() {
  if (_home.state.systemState === 'AWAY') {
    _home.executeCommandByName('RUN_ON_AWAY', 'AWAY_TIMER');
  }
};

cronJob();
