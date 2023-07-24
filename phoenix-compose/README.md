# phoenix-compose

Command **phoenix-compose** transforms Open5GCore ip-map config to Docker Compose.
During this transformation, it can:

* Apply a [network definition](../netdef).
* Replace Radio Access Network (RAN) with another software.
* Split the deployment to multiple host machines bridged via VXLAN.
s