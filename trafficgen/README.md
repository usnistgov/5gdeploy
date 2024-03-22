# 5gdeploy/trafficgen

Package **trafficgen** contains scripts that help preparing traffic generation and analyzing traffic statistics.
These scripts are integrated into [netdef-compose](../netdef-compose/README.md) command.
They can be invoked after the UEs have been registered and the PDU sessions have been established.

## List PDU Sessions

```bash
cd ~/compose/20230601
./compose.sh list-pdu
```

This command prints a TSV document that lists all established PDU sessions.
The information is gathered by executing `ip addr show` in each UE container, and then matching the interface IP addresses against UE subnets defined for Data Networks.
If a UE container runs multiple UEs (e.g. UERANSIM), the report would be imprecise because this command cannot identify which UE owns each IP address.

## nmap

`./compose.sh nmap` performs nmap ping scans from Data Network to determine how many UEs are reachable.
`--dnn` flag, specified as a [minimatch](https://www.npmjs.com/package/minimatch) pattern, selects which Data Network(s) to scan.
The scanned subnet size for each Data Network is adjusted to cover all online UEs.
`--cmdout` flag saves the commands to a file instead of executing.

```bash
cd ~/compose/20230601
./compose.sh nmap

# scan specific Data Networks
./compose.sh nmap --dnn='internet'

# print commands instead of executing
./compose.sh nmap --cmdout=-

# save commands to file instead of executing
./compose.sh nmap --cmdout=nmap.sh
```

## iperf3

`./compose.sh iperf3` sets up iperf3 sessions between UEs and Data Networks over PDU sessions.
It supports pattern matching for both UE SUPI and Data Network Name (DNN).
See [iperf3](iperf3.md) for usage.
