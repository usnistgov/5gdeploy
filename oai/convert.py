import json
import libconf
import sys
import typing as T


def tag_la(parent: dict[str, T.Any] | None, key: str, value: T.Any) -> T.Any:
    if isinstance(value, dict):
        d = dict()
        for k, v in value.items():
            d[k] = tag_la(d, k, v)
        return d

    if isinstance(value, tuple):
        parent[key + ':dtype'] = 'l'
        return [tag_la(None, '', item) for item in value]

    if isinstance(value, list):
        parent[key + ':dtype'] = 'a'

    return value


def recover_la(parent: dict[str, T.Any] | None, key: str, value: T.Any) -> T.Any:
    if isinstance(value, dict):
        d = dict()
        for k, v in value.items():
            if k.endswith(':dtype'):
                continue
            d[k] = recover_la(value, k, v)
        return d

    if isinstance(value, list):
        t = parent[key + ':dtype']
        if t == 'l':
            return tuple([recover_la(None, '', item) for item in value])
        elif t == 'a':
            pass
        else:
            raise ValueError(f"recover_la lacks information for {key} {value}")

    return value


if sys.argv[1] == 'conf2json':
    filename = sys.argv[2]
    with open(filename, 'r') as f:
        body = f.read()
    body = body.replace("mnc = 01;", "mnc = 1;")
    c = libconf.loads(body, filename)
    c = tag_la(None, '', c)
    json.dump(c, sys.stdout, indent=2, sort_keys=True)
elif sys.argv[1] == 'json2conf':
    c = json.load(sys.stdin)
    c = recover_la(None, '', c)
    libconf.dump(c, sys.stdout)
