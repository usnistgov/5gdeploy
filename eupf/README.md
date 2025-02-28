# 5gdeploy/eupf

Package **eupf** generates [eUPF](https://github.com/edgecomllc/eupf) configuration.
This package offers these choices in the **netdef-compose** command:

* `--up=eupf`

It's necessary to manually build the eUPF Docker image with either of these commands:

```bash
# based on official image from GitHub Container Registry
./docker/build.sh eupf

# enable BPF debug
docker build --pull -t localhost/eupf --build-arg BPF_ENABLE_LOG=1 https://github.com/edgecomllc/eupf.git
NOPULL=1 ./docker/build.sh eupf --build-arg BASE=localhost/eupf
```

To view BPF debug logs:

```bash
sudo grep 'upf:' /sys/kernel/debug/tracing/trace_pipe | tee trace.log
```
