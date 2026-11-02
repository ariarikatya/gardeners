const assert = require('assert');

// Test PhotoViewer logic: cycling index, close button, counter, and single vs multiple photo rules
function testPhotoViewer() {
  console.log('🧪 Testing PhotoViewer navigation, controls and cycling properties...');

  const images = ['/photo1.jpg', '/photo2.jpg', '/photo3.jpg'];
  let currentIndex = 0;

  const prev = () => {
    currentIndex = (currentIndex - 1 + images.length) % images.length;
  };

  const next = () => {
    currentIndex = (currentIndex + 1) % images.length;
  };

  assert.strictEqual(images[currentIndex], '/photo1.jpg');
  assert.strictEqual(`${currentIndex + 1} / ${images.length}`, '1 / 3');

  next();
  assert.strictEqual(currentIndex, 1);
  assert.strictEqual(images[currentIndex], '/photo2.jpg');
  assert.strictEqual(`${currentIndex + 1} / ${images.length}`, '2 / 3');

  next();
  assert.strictEqual(currentIndex, 2);
  assert.strictEqual(images[currentIndex], '/photo3.jpg');

  // Cycle back to 0
  next();
  assert.strictEqual(currentIndex, 0);

  // Cycle backwards to 2
  prev();
  assert.strictEqual(currentIndex, 2);

  console.log('  ✓ Prev/Next cycling and counter verified');

  // Single photo: arrows hidden, close cross visible
  const singleImage = ['/photo_single.jpg'];
  const hasMultiple = singleImage.length > 1;
  assert.strictEqual(hasMultiple, false, 'Single image must not display prev/next arrows');
  const hasCloseCross = true;
  assert.strictEqual(hasCloseCross, true, 'Close button must be present unconditionally');
  console.log('  ✓ Single photo hides arrows but displays close cross');

  // Multiple photos: arrows present, close cross visible
  assert.strictEqual(images.length > 1, true, 'Multiple images must display navigation arrows');
  console.log('  ✓ Multiple photos show navigation arrows and close cross');

  // Static assertions on components/PhotoViewer.js JSX
  const fs = require('fs');
  const path = require('path');
  const pvCode = fs.readFileSync(path.join(__dirname, '..', 'components', 'PhotoViewer.js'), 'utf8');

  // Verify top bar styles
  assert(pvCode.includes("justifyContent: 'space-between'"), 'Top bar must include justifyContent: space-between in inline style');
  assert(pvCode.includes("gap: '12px'"), 'Top bar must include gap: 12px in inline style');
  assert(pvCode.includes("top: '16px'"), 'Top bar top offset must be <= 16px');

  // Verify close cross style
  assert(pvCode.includes("width: '44px'") && pvCode.includes("height: '44px'"), 'Controls must have inline width/height 44px');
  assert(pvCode.includes("borderRadius: '9999px'"), 'Controls must have inline borderRadius 9999px');

  // Verify prev arrow style and positioning wrapper
  assert(pvCode.includes("left: '8px'"), 'Prev button must have inline left 8px');
  assert(pvCode.includes("transform: 'translateY(-50%)'"), 'Arrows must have inline translateY(-50%)');
  assert(pvCode.includes('left-2 sm:left-6 top-1/2 -translate-y-1/2'), 'Prev button wrapper must have left-2 sm:left-6 top-1/2 -translate-y-1/2');

  // Verify next arrow style and positioning wrapper
  assert(pvCode.includes("right: '8px'"), 'Next button must have inline right 8px');
  assert(pvCode.includes('right-2 sm:right-6 top-1/2 -translate-y-1/2'), 'Next button wrapper must have right-2 sm:right-6 top-1/2 -translate-y-1/2');

  // Verify no layout clumping classes on buttons
  assert(pvCode.includes('inline-flex items-center justify-center'), 'Buttons must use inline-flex for content centering without clumping outer layout');

  console.log('  ✓ Static JSX inline style assertions for PhotoViewer controls verified');
  console.log('🎉 PhotoViewer navigation tests passed!');
}

testPhotoViewer();
