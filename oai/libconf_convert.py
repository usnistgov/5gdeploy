"""
This script converts between libconfig and JSON formats.

libconfig has a distinction between an array and a list:

- An array `[scalar,scalar]` is a sequence of scalar values, all of which must have the same type.
  They are represented as a Python list.
- A list `(value,value)` is a sequence of values of any type.
  They are represented as a Python tuple.

When converting to JSON, both become JSON arrays, and the type information is lost. To make the
conversion roundtrip, this script tags libconfig arrays with `:dtype=a` and libconfig lists with
`:dtype=l`. This only works for values enclosed within a libconfig group (i.e. Python dict or JSON
object). The tag is represented as an additional property in the JSON object, with ":dtype"
appended after the property name being described.

When converting from JSON to libconfig, the same tags must exist for each JSON array within a JSON
object. Otherwise, it is an error. Currently, array/list within a list is not supported.
"""


import json
import sys
import typing as T

import libconf


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
    c = libconf.load(sys.stdin, sys.argv[2])
    c = tag_la(None, '', c)
    json.dump(c, sys.stdout, indent=2, sort_keys=True)
elif sys.argv[1] == 'json2conf':
    c = json.load(sys.stdin)
    c = recover_la(None, '', c)
    libconf.dump(c, sys.stdout)
