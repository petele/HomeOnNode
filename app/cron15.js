/* globals log, home */

'use strict';

var cronJob = function() {
  log.log('[Cron15]');

  if (home.state.systemState === 'AWAY') {
    home.executeCommandByName('LIGHTS_ALL', 'OFF', 'AWAY_TIMER');
  }
};

cronJob();
