/* globals log, fb */

'use strict';

var cronJob = function() {
  log.log('[CronDaily]');
  cleanLogs('logs/doors');
  cleanLogs('logs/logs', 2);
  cleanLogs('logs/presence');
  cleanLogs('logs/systemState');
};

function cleanLogs(path, maxAgeDays) {
  maxAgeDays = maxAgeDays || 90;
  var endAt = Date.now() - (1000 * 60 * 60 * 24 * maxAgeDays);
  log.log('[CleanLogs] Cleaning path: ', path);
  fb.child(path).orderByChild('date').endAt(endAt).once('value',
    function(snapshot) {
      var itemsRemoved = 0;
      snapshot.forEach(function(item) {
        item.ref().remove();
        itemsRemoved++;
      });
      var msg = '[CleanLogs] Removed: [COUNT] from [PATH]';
      msg = msg.replace('[COUNT]', itemsRemoved);
      msg = msg.replace('[PATH]', path);
      log.log(msg);
    }
  );
}

cronJob();
