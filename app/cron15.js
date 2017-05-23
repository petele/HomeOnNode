/* globals home */

'use strict';

const cronJob = function() {
  if (home.state.systemState === 'AWAY') {
    const allOff = {
      hueCommand: {
        lights: 0,
        lightState: {on: false},
      },
    };
    home.executeCommand(allOff, 'AWAY_TIMER');
  }
};

cronJob();
