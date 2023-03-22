#!/usr/bin/python
import configparser
import sys

filename = sys.argv[1]
c = configparser.ConfigParser()
c.read(filename)

modified = False
for a in sys.argv[2:]:
    kv = a.split('=', 1)
    sec, key = kv[0].split('.', 1)
    if len(kv) == 2:
        value = kv[1]
        if len(value) == 0:
            try:
                del c[sec][key]
            except KeyError:
                pass
        else:
            c[sec][key] = value
        modified = True
    else:
        try:
            print(c[sec][key])
        except KeyError:
            print()

if modified:
    with open(filename, 'w') as output:
        c.write(output)
