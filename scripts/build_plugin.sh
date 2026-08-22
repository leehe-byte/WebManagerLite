#!/bin/bash
# OpenGW 插件打包 + 可选签名脚本
# 用法: ./scripts/build_plugin.sh <插件目录> <输出.owpkg> [私钥.pem]
# 私钥默认取 releases/keys/private.pem；不签名则传 "none"
set -e

SRC="${1:?用法: build_plugin.sh <插件目录> <输出.owpkg> [私钥.pem|none]}"
OUT="${2:?用法: build_plugin.sh <插件目录> <输出.owpkg> [私钥.pem|none]}"
KEY="${3:-releases/keys/private.pem}"

TMP=$(mktemp -d)

# 1. 打包为 zip（正斜杠路径）
python - "$SRC" "$TMP/plugin.zip" <<'PYEOF'
import sys, os, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src).replace(os.sep, '/'))
PYEOF

# 2. 可选签名：对 manifest.json 原始字节做 RSA-SHA256
if [ "$KEY" != "none" ] && [ -f "$KEY" ]; then
    openssl dgst -sha256 -sign "$KEY" -out "$TMP/signature.sig" "$SRC/manifest.json"
    SIG_FILE="$TMP/signature.sig"
    echo "已签名（SHA256withRSA）"
else
    SIG_FILE=""
    echo "未签名"
fi

# 3. 追加 signature.sig（如有）
python - "$TMP/plugin.zip" "$SIG_FILE" "$OUT" <<'PYEOF'
import sys, zipfile
zin, sig, out = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zout:
    with zipfile.ZipFile(zin) as zin2:
        for item in zin2.infolist():
            zout.writestr(item, zin2.read(item.filename))
    if sig and sig != "":
        zout.write(sig, 'signature.sig')
PYEOF

rm -rf "$TMP"
echo "打包完成: $OUT"
