TODO
----

[ ] Change AC to work synchronously when turning on
[ ] Up away watch timer to 600000
[ ] Add external web front end
[ ] Add internal web front end
[ ] Setup log rotation
[ ] Add method to clean up logs as they get older
[ ] Add Phone support for front door



Serial node stuff
https://github.com/voodootikigod/node-serialport

Serial commands
- http://en.wikipedia.org/wiki/Hayes_command_set#The_basic_Hayes_command_set
- Answer ATA or ATH1
- Hang up - ATH0
- Dial ATDT
- Set length of dial tone ATS11=255

PowerMate
- http://mattwel.ch/controlling-a-sonos-with-the-griffin-powermate/

Node issues
- https://www.digitalocean.com/community/tutorials/how-to-install-node-js-on-an-ubuntu-14-04-server
- http://superuser.com/questions/759142/setting-node-path-and-allowing-to-run-as-sudo



Exit Codes:
0  shut down
1  Config file error
2  Uncaught exception
10 Restart