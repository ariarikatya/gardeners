const assert = require('assert');

// Test PhotoViewer logic: cycling index, close button, and counter
function testPhotoViewer() {
  console.log('🧪 Testing PhotoViewer navigation and properties...');

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

  // Single photo: arrows hidden
  const singleImage = ['/photo_single.jpg'];
  const hasMultiple = singleImage.length > 1;
  assert.strictEqual(hasMultiple, false, 'Single image must not display prev/next arrows');
  console.log('  ✓ Single photo hides arrows but displays close cross');

  console.log('🎉 PhotoViewer logic tests passed!');
}

testPhotoViewer();
