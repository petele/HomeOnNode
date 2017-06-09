'use strict';

const helpers = require('./helpers');
const assert = require('../node_modules/chai').assert;

helpers.setBasicLogging();

describe('Sonos', function() {
  let _Sonos;
  let _sonos;

  const WAIT_AFTER_COMMAND = 3500;
  const READY_TIMEOUT = 100 * 1000;
  const TEST_TIMEOUT = READY_TIMEOUT + (100 * 1000);
  this.timeout(TEST_TIMEOUT);

  const PRESET_OPTIONS = {
    TEST: {
      pauseOthers: true,
      players: [
        {roomName: 'Living Room', volume: 21},
        {roomName: 'Bedroom', volume: 22},
        {roomName: 'Bathroom', volume: 23},
        {roomName: 'Kitchen', volume: 24},
      ],
    }
  };
  let FAV_URI = 'x-sonosapi-radio:AfxTiv5ZdSxPyc3oBrGLgjWWEnfl-F4cYFWUitmkM37';
  FAV_URI += 'MkTUlZF5-m-4P2whEVE7Q?sid=151&flags=8300&sn=1';

  const _expectedStateCount = 8;

  let _state = {};
  let _stateChangedCount = 0;
  let _favorites = [];

  before(function() {
    _Sonos = require('../Sonos');
    _sonos = new _Sonos();
    _sonos.on('player-state', function(state) {
      _stateChangedCount++;
      _state = state;
    });
    _sonos.on('favorites-changed', function(favorites) {
      _favorites = favorites;
    });
    return new Promise(function(resolve, reject) {
      _sonos.on('ready', function() {
        resolve();
      });
      setTimeout(function() {
        reject(new Error('timeout_waiting_for_ready'));
      }, READY_TIMEOUT);
    });
  });

  afterEach(function() {
    return helpers.sleep(6 * 1000);
  });

  describe('#executeCommand()', function() {
    it('should start playing a preset station', function() {
      let cmd = {
        name: 'PRESET',
        uri: FAV_URI,
        options: 'TEST',
      };
      return _sonos.executeCommand(cmd, PRESET_OPTIONS)
      .then(function() {
        return helpers.sleep(WAIT_AFTER_COMMAND);
      })
      .then(function() {
        assert.equal(_state.playbackState, 'PLAYING');
      });
    });
    it('should pause the music', function() {
      return _sonos.executeCommand({name: 'PAUSE'})
      .then(function() {
        return helpers.sleep(WAIT_AFTER_COMMAND);
      })
      .then(function() {
        assert.equal(_state.playbackState, 'PAUSED_PLAYBACK');
      });
    });
    it('should start playing the music', function() {
      return _sonos.executeCommand({name: 'PLAY'})
      .then(function() {
        return helpers.sleep(WAIT_AFTER_COMMAND);
      })
      .then(function() {
        assert.equal(_state.playbackState, 'PLAYING');
      });
    });
    it('should play the next song', function() {
      let newTrack = '';
      let oldTrack = _state.currentTrack.title;
      return _sonos.executeCommand({name: 'NEXT'})
      .then(function() {
        return helpers.sleep(WAIT_AFTER_COMMAND);
      })
      .then(function() {
        newTrack = _state.currentTrack.title;
        assert.notEqual(newTrack, oldTrack);
        oldTrack = newTrack;
      });
    });
    // it('should play the previous song', function() {
    //   let oldTrack = _state.currentTrack.title;
    //   return _sonos.executeCommand({name: 'PREVIOUS'})
    //   .then(function() {
    //     return helpers.sleep(WAIT_AFTER_COMMAND);
    //   })
    //   .then(function() {
    //     assert.notEqual(_state.currentTrack.title, oldTrack);
    //   });
    // });
    it('should turn the volume up', function() {
      let oldVol = _state.volume;
      return _sonos.executeCommand({name: 'VOLUME_UP'})
      .then(function() {
        return _sonos.executeCommand({name: 'VOLUME_UP'});
      })
      .then(function() {
        return _sonos.executeCommand({name: 'VOLUME_UP'});
      })
      .then(function() {
        return helpers.sleep(WAIT_AFTER_COMMAND);
      })
      .then(function() {
        return _sonos.executeCommand({name: 'NEXT'})
      })
      .then(function() {
        return helpers.sleep(WAIT_AFTER_COMMAND);
      })
      .then(function() {
        assert.isAbove(_state.volume, oldVol);
      });
    });
    it('should turn the volume down', function() {
      let oldVol = _state.volume;
      return _sonos.executeCommand({name: 'VOLUME_DOWN'})
      .then(function() {
        return _sonos.executeCommand({name: 'VOLUME_DOWN'});
      })
      .then(function() {
        return _sonos.executeCommand({name: 'VOLUME_DOWN'});
      })
      .then(function() {
        return helpers.sleep(WAIT_AFTER_COMMAND);
      })
      .then(function() {
        return _sonos.executeCommand({name: 'NEXT'})
      })
      .then(function() {
        return helpers.sleep(WAIT_AFTER_COMMAND);
      })
      .then(function() {
        assert.isBelow(_state.volume, oldVol);
      });
    });
    it('should throw error for unknown command', function() {
      return _sonos.executeCommand({foo: 'bar'})
      .catch(function(err) {
        assert.equal(err.message, 'unknown_command');
      });
    });
  });

  describe('Sonos Favorites', function() {
    it('should have several favorites', function() {
      assert.isAtLeast(_favorites.length, 1);
    });
  });


  describe('Sonos Status', function() {
    it('should have a complete state object', function() {
      assert.isNotEmpty(_state);
      assert.closeTo(_stateChangedCount, _expectedStateCount, 4);
    });
  });

  after(function() {
    return _sonos.executeCommand({name: 'PAUSE'});
  });
});
