# 5gdeploy/eupf

Package **eupf** generates [eUPF](https://github.com/edgecomllc/eupf) configuration.
This package offers these choices in the **netdef-compose** command:

* `--up=eupf`

By default, the eUPF Docker image is based on the official image from GitHub Container Registry.
If it's necessary to enable BPF debug, replace the image with the following commands:

```bash
docker build --pull -t localhost/eupf --build-arg BPF_ENABLE_LOG=1 https://github.com/edgecomllc/eupf.git
NOPULL=1 ./docker/build.sh eupf --build-arg BASE=localhost/eupf
```

To view BPF debug logs:

```bash
sudo grep 'upf:' /sys/kernel/debug/tracing/trace_pipe | tee trace.log
```
