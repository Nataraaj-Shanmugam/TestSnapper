#!/bin/bash
# TestSnapper - Create Chrome Web Store Release ZIP
# Run this after npm run build

echo "========================================"
echo "TestSnapper v1.1.3 - Release Packager"
echo "========================================"
echo ""

# Check if dist folder exists
if [ ! -d "dist" ]; then
    echo "ERROR: dist/ folder not found!"
    echo "Please run: npm run build"
    exit 1
fi

# Check if libs are downloaded
if [ ! -f "dist/libs/docx.min.js" ]; then
    echo "ERROR: Libraries not found in dist/libs/"
    echo "Please run: npm run setup-libs"
    exit 1
fi

echo "Verifying dist/ contents..."
echo ""

MISSING=0

# Check required files
check_file() {
    if [ -f "$1" ]; then
        echo "  [OK] $2"
    else
        echo "  [MISSING] $2"
        MISSING=1
    fi
}

check_file "dist/manifest.json" "manifest.json"
check_file "dist/src/background/background.js" "src/background/background.js"
check_file "dist/libs/docx.min.js" "libs/docx.min.js"
check_file "dist/libs/html2pdf.bundle.min.js" "libs/html2pdf.bundle.min.js"

if [ $MISSING -eq 1 ]; then
    echo ""
    echo "ERROR: Required files are missing!"
    echo "Please run: npm run build"
    exit 1
fi

echo ""
echo "All required files present!"
echo ""

# Create release ZIP with timestamp
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
RELEASE_ZIP="testsnapper-v1.1.3-${TIMESTAMP}.zip"

echo "Creating ZIP: ${RELEASE_ZIP}"
echo ""

# Remove old zip if exists
rm -f "$RELEASE_ZIP"

# Create ZIP
cd dist && zip -r "../${RELEASE_ZIP}" . && cd ..

if [ -f "$RELEASE_ZIP" ]; then
    FILE_SIZE=$(du -h "$RELEASE_ZIP" | cut -f1)
    echo ""
    echo "========================================"
    echo "SUCCESS! Release package created:"
    echo "$RELEASE_ZIP"
    echo "Size: $FILE_SIZE"
    echo "========================================"
    echo ""
    echo "File location: $(pwd)/${RELEASE_ZIP}"
    echo ""
    echo "Next steps:"
    echo "1. Go to: https://chrome.google.com/webstore/devconsole"
    echo "2. Click 'Upload new package'"
    echo "3. Select: ${RELEASE_ZIP}"
    echo "4. Fill in store listing details"
    echo "5. Submit for review"
    echo ""
else
    echo ""
    echo "ERROR: Failed to create ZIP file"
    exit 1
fi
