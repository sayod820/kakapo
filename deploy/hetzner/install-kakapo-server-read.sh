#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
unset NODE_OPTIONS NODE_PATH
unset GIT_DIR GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
unset GIT_CONFIG_PARAMETERS GIT_EXEC_PATH GIT_SSH GIT_SSH_COMMAND GIT_PROXY_COMMAND
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_COUNT=0
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/false
export NPM_CONFIG_USERCONFIG=/dev/null
export NPM_CONFIG_GLOBALCONFIG=/dev/null
export NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
export NPM_CONFIG_IGNORE_SCRIPTS=true

readonly SOURCE_URL='https://github.com/sayod820/kakapo.git'
readonly REMOTE_REF='refs/remotes/origin/release/online-v1'
readonly INSTALLER_PATH='deploy/hetzner/install-kakapo-server-read.sh'
readonly LIB_LINK='/usr/local/lib/kakapo-server-read-current'
readonly WRAPPER_TARGET='/usr/local/sbin/kakapo-server-read'
readonly SUDOERS_TARGET='/etc/sudoers.d/kakapo-server-read'
readonly CONFIG_TARGET='/etc/kakapo-server-read.conf'

ROOT_STAGE=''
INSTALL_STAGE=''
LINK_CANDIDATE=''
WRAPPER_CANDIDATE=''
SUDOERS_CANDIDATE=''

die() {
  echo "KAKAPO SERVER READ INSTALL ABORTED: $*" >&2
  exit 1
}

cleanup() {
  if [[ -n ${ROOT_STAGE} && ${ROOT_STAGE} == /run/kakapo-server-read-install.* && -d ${ROOT_STAGE} ]]; then
    rm -rf -- "${ROOT_STAGE}"
  fi
  if [[ -n ${INSTALL_STAGE} && ${INSTALL_STAGE} == /usr/local/lib/.kakapo-server-read.install.* && -d ${INSTALL_STAGE} ]]; then
    rm -rf -- "${INSTALL_STAGE}"
  fi
  [[ -z ${LINK_CANDIDATE} || ! -L ${LINK_CANDIDATE} ]] || rm -f -- "${LINK_CANDIDATE}"
  [[ -z ${WRAPPER_CANDIDATE} || ! -f ${WRAPPER_CANDIDATE} ]] || rm -f -- "${WRAPPER_CANDIDATE}"
  [[ -z ${SUDOERS_CANDIDATE} || ! -f ${SUDOERS_CANDIDATE} ]] || rm -f -- "${SUDOERS_CANDIDATE}"
}
trap cleanup EXIT

[[ ${EUID} -eq 0 ]] || die 'must run as root'
[[ $# -eq 1 ]] || die 'usage: install-kakapo-server-read.sh <FULL_40_CHARACTER_SHA>'
readonly APPROVED_SHA=$1
[[ ${APPROVED_SHA} =~ ^[0-9a-f]{40}$ ]] || die 'approved SHA must be exactly 40 lowercase hexadecimal characters'

CONFIG_NEEDS_CREATE=0
if [[ ! -e ${CONFIG_TARGET} ]]; then
  CONFIG_NEEDS_CREATE=1
else
  [[ -f ${CONFIG_TARGET} && ! -L ${CONFIG_TARGET} ]] || die 'inspector config must be a regular non-symlink file'
  [[ $(/usr/bin/stat -c '%u:%g:%a' "${CONFIG_TARGET}") == '0:0:600' ]] \
    || die 'inspector config must be root:root mode 0600'
fi

SUDOERS_HAD_PREVIOUS=0
SUDOERS_BACKUP=''
if [[ -e ${SUDOERS_TARGET} ]]; then
  [[ -f ${SUDOERS_TARGET} && ! -L ${SUDOERS_TARGET} ]] \
    || die 'existing inspector sudoers entry must be a regular non-symlink file'
  [[ $(/usr/bin/stat -c '%u:%g:%a' "${SUDOERS_TARGET}") == '0:0:440' ]] \
    || die 'existing inspector sudoers entry must be root:root mode 0440'
  SUDOERS_HAD_PREVIOUS=1
fi

DEPLOY_WRAPPER_HASH_BEFORE=''
if [[ -f /usr/local/sbin/kakapo-deploy-online && ! -L /usr/local/sbin/kakapo-deploy-online ]]; then
  DEPLOY_WRAPPER_HASH_BEFORE=$(/usr/bin/sha256sum -- /usr/local/sbin/kakapo-deploy-online | /usr/bin/cut -d' ' -f1)
fi

ROOT_STAGE=$(/usr/bin/mktemp -d '/run/kakapo-server-read-install.XXXXXX')
[[ $(/usr/bin/stat -c '%u:%g:%a' "${ROOT_STAGE}") == '0:0:700' ]] \
  || die 'root staging ownership/mode verification failed'
if [[ ${SUDOERS_HAD_PREVIOUS} -eq 1 ]]; then
  SUDOERS_BACKUP="${ROOT_STAGE}/previous.kakapo-server-read.sudoers"
  /usr/bin/install -o root -g root -m 0440 "${SUDOERS_TARGET}" "${SUDOERS_BACKUP}"
fi
readonly SOURCE_GIT_DIR="${ROOT_STAGE}/source.git"
/usr/bin/git init --bare --quiet "${SOURCE_GIT_DIR}"
/usr/bin/git -C "${SOURCE_GIT_DIR}" remote add origin "${SOURCE_URL}"
/usr/bin/git -C "${SOURCE_GIT_DIR}" fetch --force --no-tags origin \
  '+refs/heads/release/online-v1:refs/remotes/origin/release/online-v1'
REMOTE_SHA=$(/usr/bin/git -C "${SOURCE_GIT_DIR}" \
  rev-parse --verify "${REMOTE_REF}^{commit}")
[[ ${REMOTE_SHA} == "${APPROVED_SHA}" ]] || die 'approved SHA does not equal origin/release/online-v1'
[[ $(/usr/bin/git -C "${SOURCE_GIT_DIR}" cat-file -t "${APPROVED_SHA}") == commit ]] \
  || die 'approved SHA is not a commit object'

# The invoked installer must itself be byte-identical to the approved Git object.
EXPECTED_SELF_HASH=$(/usr/bin/git -C "${SOURCE_GIT_DIR}" \
  show "${APPROVED_SHA}:${INSTALLER_PATH}" | /usr/bin/sha256sum | /usr/bin/cut -d' ' -f1)
ACTUAL_SELF_HASH=$(/usr/bin/sha256sum -- "${BASH_SOURCE[0]}" | /usr/bin/cut -d' ' -f1)
[[ ${EXPECTED_SELF_HASH} == "${ACTUAL_SELF_HASH}" ]] || die 'installer is not the exact approved Git object'

readonly -a ARTIFACTS=(
  'deploy/hetzner/KAKAPO_SERVER_READ.md'
  'deploy/hetzner/install-kakapo-server-read.sh'
  'deploy/hetzner/kakapo-server-read-role.sql'
  'deploy/hetzner/kakapo-server-read-wrapper'
  'deploy/hetzner/kakapo-server-read.sudoers'
  'deploy/hetzner/kakapo-server-read/cli.mjs'
  'deploy/hetzner/kakapo-server-read/db.mjs'
  'deploy/hetzner/kakapo-server-read/package.json'
  'deploy/hetzner/kakapo-server-read/package-lock.json'
  'deploy/hetzner/kakapo-server-read/policy.mjs'
)

/usr/bin/git -C "${SOURCE_GIT_DIR}" \
  archive --format=tar "${APPROVED_SHA}" -- "${ARTIFACTS[@]}" \
  | /usr/bin/tar -xf - -C "${ROOT_STAGE}"

MANIFEST="${ROOT_STAGE}/SHA256SUMS"
: > "${MANIFEST}"
for artifact in "${ARTIFACTS[@]}"; do
  staged="${ROOT_STAGE}/${artifact}"
  [[ -f ${staged} && ! -L ${staged} ]] || die "artifact is missing, non-regular, or a symlink: ${artifact}"
  expected=$(/usr/bin/git -C "${SOURCE_GIT_DIR}" \
    show "${APPROVED_SHA}:${artifact}" | /usr/bin/sha256sum | /usr/bin/cut -d' ' -f1)
  actual=$(/usr/bin/sha256sum -- "${staged}" | /usr/bin/cut -d' ' -f1)
  [[ ${expected} == "${actual}" ]] || die "hash mismatch: ${artifact}"
  printf '%s  %s\n' "${actual}" "${artifact}" >> "${MANIFEST}"
done

LIB_SOURCE="${ROOT_STAGE}/deploy/hetzner/kakapo-server-read"
/usr/bin/npm ci --prefix "${LIB_SOURCE}" --omit=dev --ignore-scripts --no-audit --no-fund \
  --registry=https://registry.npmjs.org/ --userconfig=/dev/null

readonly LIB_TARGET="/usr/local/lib/kakapo-server-read-${APPROVED_SHA}"
readonly SHARE_TARGET="/usr/local/share/kakapo-server-read-${APPROVED_SHA}"
[[ ! -e ${LIB_TARGET} ]] || die "versioned library already exists: ${LIB_TARGET}"
[[ ! -e ${SHARE_TARGET} ]] || die "versioned metadata already exists: ${SHARE_TARGET}"
[[ ! -e ${LIB_LINK} || -L ${LIB_LINK} ]] || die "refusing to replace non-symlink ${LIB_LINK}"

INSTALL_STAGE=$(/usr/bin/mktemp -d '/usr/local/lib/.kakapo-server-read.install.XXXXXX')
/bin/cp -a -- "${LIB_SOURCE}/." "${INSTALL_STAGE}/"
/bin/chown -R root:root "${INSTALL_STAGE}"
/bin/chmod -R go-w "${INSTALL_STAGE}"

for artifact in cli.mjs db.mjs policy.mjs package.json package-lock.json; do
  source_hash=$(/usr/bin/sha256sum -- "${LIB_SOURCE}/${artifact}" | /usr/bin/cut -d' ' -f1)
  installed_hash=$(/usr/bin/sha256sum -- "${INSTALL_STAGE}/${artifact}" | /usr/bin/cut -d' ' -f1)
  [[ ${source_hash} == "${installed_hash}" ]] || die "installed library hash mismatch: ${artifact}"
done

/bin/mv -- "${INSTALL_STAGE}" "${LIB_TARGET}"
INSTALL_STAGE=''

/usr/bin/install -d -o root -g root -m 0755 "${SHARE_TARGET}"
/usr/bin/install -o root -g root -m 0644 \
  "${ROOT_STAGE}/deploy/hetzner/kakapo-server-read-role.sql" \
  "${ROOT_STAGE}/deploy/hetzner/KAKAPO_SERVER_READ.md" \
  "${MANIFEST}" \
  "${SHARE_TARGET}/"

LINK_CANDIDATE="/usr/local/lib/.kakapo-server-read-current.$$"
/bin/ln -s -- "${LIB_TARGET}" "${LINK_CANDIDATE}"
/bin/mv -Tf -- "${LINK_CANDIDATE}" "${LIB_LINK}"
LINK_CANDIDATE=''

WRAPPER_CANDIDATE=$(/usr/bin/mktemp '/usr/local/sbin/.kakapo-server-read.XXXXXX')
/usr/bin/install -o root -g root -m 0755 \
  "${ROOT_STAGE}/deploy/hetzner/kakapo-server-read-wrapper" "${WRAPPER_CANDIDATE}"
[[ $(/usr/bin/sha256sum -- "${WRAPPER_CANDIDATE}" | /usr/bin/cut -d' ' -f1) == \
   $(/usr/bin/sha256sum -- "${ROOT_STAGE}/deploy/hetzner/kakapo-server-read-wrapper" | /usr/bin/cut -d' ' -f1) ]] \
  || die 'wrapper hash verification failed'
/bin/mv -f -- "${WRAPPER_CANDIDATE}" "${WRAPPER_TARGET}"
WRAPPER_CANDIDATE=''

SUDOERS_CANDIDATE=$(/usr/bin/mktemp '/etc/sudoers.d/.kakapo-server-read.XXXXXX')
/usr/bin/install -o root -g root -m 0440 \
  "${ROOT_STAGE}/deploy/hetzner/kakapo-server-read.sudoers" "${SUDOERS_CANDIDATE}"
/usr/sbin/visudo -cf "${SUDOERS_CANDIDATE}"
/bin/mv -f -- "${SUDOERS_CANDIDATE}" "${SUDOERS_TARGET}"
SUDOERS_CANDIDATE=''
if ! /usr/sbin/visudo -c; then
  if [[ ${SUDOERS_HAD_PREVIOUS} -eq 1 ]]; then
    /usr/bin/install -o root -g root -m 0440 "${SUDOERS_BACKUP}" "${SUDOERS_TARGET}"
  else
    /bin/rm -f -- "${SUDOERS_TARGET}"
  fi
  /usr/sbin/visudo -c || die 'sudoers rollback did not restore a valid configuration'
  die 'new inspector sudoers entry failed full configuration validation and was rolled back'
fi

if [[ ${CONFIG_NEEDS_CREATE} -eq 1 ]]; then
  /usr/bin/install -o root -g root -m 0600 /dev/null "${CONFIG_TARGET}"
fi

[[ $(/usr/bin/stat -c '%u:%g:%a' "${WRAPPER_TARGET}") == '0:0:755' ]] \
  || die 'installed wrapper ownership/mode verification failed'
[[ $(/usr/bin/stat -c '%u:%g:%a' "${SUDOERS_TARGET}") == '0:0:440' ]] \
  || die 'installed sudoers ownership/mode verification failed'
[[ $(/usr/bin/stat -c '%u:%g' "${LIB_TARGET}") == '0:0' ]] \
  || die 'installed library ownership verification failed'
if [[ -n ${DEPLOY_WRAPPER_HASH_BEFORE} ]]; then
  [[ -f /usr/local/sbin/kakapo-deploy-online && ! -L /usr/local/sbin/kakapo-deploy-online ]] \
    || die 'existing deploy wrapper changed type during install'
  [[ $(/usr/bin/sha256sum -- /usr/local/sbin/kakapo-deploy-online | /usr/bin/cut -d' ' -f1) == "${DEPLOY_WRAPPER_HASH_BEFORE}" ]] \
    || die 'existing deploy wrapper changed during install'
fi

echo 'KAKAPO SERVER READ R1.6 FILE INSTALL SUCCESS'
echo "SHA=${APPROVED_SHA}"
echo "MANIFEST=${SHARE_TARGET}/SHA256SUMS"
echo 'PostgreSQL role SQL and root-only connection secret still require separate approved provisioning.'
