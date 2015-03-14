var cronJob = function() {
  log.log("[CronDaily]");

  cleanLogs("logs/app", 30);
  cleanLogs("logs/door", 120);
  cleanLogs("logs/door-closet", 30);
  cleanLogs("logs/errors", 7);
  cleanLogs("logs/presence", 365);
  cleanLogs("logs/system_state", 120);
  cleanLogs("logs/temperature/inside", 365);
};


function cleanLogs(path, maxAgeDays) {
  var now = Date.now();
  log.log("[CleanLogs] Cleaning path: ", path);
  fb.child(path).once("value", function(snapshot) {
    var maxAgeMilli = 60 * 60 * 24 * maxAgeDays * 1000;
    var countTotal = 0;
    var countRemoved = 0;
    snapshot.forEach(function(childSnapshot) {
      countTotal++;
      var age = now - childSnapshot.val().date;
      if (age > maxAgeMilli) {
        countRemoved++;
        log.debug("[CleanLogs] Removed: " + childSnapshot.val());
        childSnapshot.ref().remove();
      }
    });
    var msg = "[CleanLog] Completed. Checked: [countTotal], Removed: [countRemoved]";
    msg = msg.replace("[countTotal]", countTotal);
    msg = msg.replace("[countRemoved]", countRemoved);
    log.log(msg);
  });
}


cronJob();
