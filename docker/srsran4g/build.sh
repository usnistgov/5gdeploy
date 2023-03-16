#!/bin/bash
set -euo pipefail
SRSRAN_VERSION=$1
DIR=/root/srsran-${SRSRAN_VERSION}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -qq --no-install-recommends ca-certificates curl devscripts equivs gawk

mkdir -p $DIR
cd $DIR
curl -sfLS https://github.com/srsran/srsRAN_4G/archive/release_${SRSRAN_VERSION/./_}.tar.gz | tar xz --strip-components=1

. /etc/os-release
cat >debian/changelog <<EOT
srsran (${SRSRAN_VERSION}) ${VERSION_CODENAME}; urgency=medium
  * Automated build of version ${SRSRAN_VERSION}
 -- Junxiao Shi <deb@mail1.yoursunny.com>  $(date -R)
EOT

sed -i "/Build-Depends:/ s|:.*$|: libboost-system-dev, libzmq3-dev,|" debian/control
echo >>debian/control
for DRV in uhd zmq; do
  cat >>debian/control <<EOT

Package: srsran-rf-${DRV}
Architecture: any
Depends: \${shlibs:Depends}, \${misc:Depends}, srsran-core (= \${binary:Version})
Description: srsRAN ${DRV} radio driver.
EOT
  echo "usr/lib/*/libsrsran_rf_${DRV}.so*" >>debian/srsran-rf-$DRV.install
done

for F in debian/srslte-core*; do mv $F ${F/srslte/srsran}; done
rm -rf debian/source debian/srsran-core.postinst

mk-build-deps -ir -t "apt-get -y -o Debug::pkgProblemResolver=yes --no-install-recommends"
debuild -us -uc
