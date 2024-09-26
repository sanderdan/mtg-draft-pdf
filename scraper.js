const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs'); // Standard fs module for streams
const fsPromises = require('fs').promises; // Promises-based fs for async operations
const path = require('path');
const https = require('https'); // For downloading images

const setVersion = process.argv[2]; // This will hold the value you pass in like 'mh3'

// Check if the argument is provided
if (!setVersion) {
  console.error("Please provide the set version, e.g., 'node scraper.js mh3'.");
  process.exit(1); // Exit if no argument is provided
}

async function fetchData(url) {
  try {
    const { data } = await axios.get(url);
    return data;
  } catch (error) {
    console.error('Error fetching data:', error);
    throw error; // Rethrow for further handling
  }
}

function extractArchetypes(html) {
  const $ = cheerio.load(html);
  const archetypes = [];

  // Extract image titles
  const imageTitles = [];
  $('#archetypes p.title').each((i, el) => {
    const titleText = $(el).text().trim();
    // Split by semicolon and take the first title only
    const firstTitle = titleText.split(';')[0].trim(); // Get the first title and trim whitespace
    imageTitles.push(firstTitle); // Push the first title to imageTitles array
  });

  // Iterate through all <h3> elements to get titles and descriptions
  $('h3').each((i, el) => {
    const title = $(el).text().trim() || 'No title'; // Main title for the <h2>
    const description = [];

    // Get the next sibling elements until the next header is found
    let nextElement = $(el).next();
    while (nextElement.length && !nextElement.is('h3')) {
      // Check if it's a <p> and doesn't have a class of 'title' or 'subtitle'
      if (nextElement.is('p') && !nextElement.hasClass('title') && !nextElement.hasClass('subtitle')) {
        description.push(nextElement.text().trim());
      }
      nextElement = nextElement.next();
    }

    // Join the description paragraphs into a single string
    const descriptionText = description.join(' ') || 'No description';

    // Push main title, description, and corresponding image title
    archetypes.push({ title, description: descriptionText, imageTitle: imageTitles[i] || 'No image title' });
  });

  return archetypes;
}

async function downloadImage(url, title) {
  const dir = path.join(__dirname, 'images', setVersion);
  const sanitizedTitle = title.replace(/[^a-zA-Z0-9-_]/g, '_'); // Sanitize the title for file name
  const filePath = path.join(dir, `${sanitizedTitle}.jpg`); // Save as JPG

  // Create the directory if it doesn't exist
  await fsPromises.mkdir(dir, { recursive: true });

  // Download the image
  const writer = fs.createWriteStream(filePath); // Use the standard fs to create a write stream
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function fetchAndDownloadImages(titles) {
  const imagePaths = {}; // Store image paths for each title

  for (const title of titles) {
    const formattedTitle = title.replace(/\s+/g, '+'); // Replace whitespace with '+'
    const searchUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(formattedTitle)}`;

    try {
      const response = await fetchData(searchUrl);
      const imageUrl = response.image_uris?.normal; // Get normal image size URI

      if (imageUrl) {
        await downloadImage(imageUrl, title);
        console.log(`Downloaded image for: ${title}`);
        imagePaths[title] = path.join('images', setVersion, `${title.replace(/[^a-zA-Z0-9-_]/g, '_')}.jpg`); // Store the path
      } else {
        console.warn(`No image found for title: ${title}`);
      }
    } catch (error) {
      console.error(`Error fetching image for "${title}":`, error);
    }
  }

  return imagePaths; // Return the paths of downloaded images
}

function generateHTML(archetypes, imagePaths) {
  let htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="shortcut icon" href="favicon.ico" />
    <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" type="text/css" href="/style.css" />
    <title>Archetypes</title>
  </head>
  <body>
    <page size="A4"> <!-- Added page element -->
    <h1>Archetypes</h1>
    <div class="archetypes"> <!-- Parent div for all archetypes -->
  `;

  archetypes.forEach(({ title, description, imageTitle }, i) => {
    const imgPath = imagePaths[imageTitle] ? `/${imagePaths[imageTitle]}` : ''; // Use imageTitle for image path
    if (i % 5 === 0) {
      htmlContent += '<div class="archetypes">';
    }

    htmlContent += `
      <div class="archetype">
        <h2>${title}</h2>
        ${imgPath ? `<img src="${imgPath}" alt="${imageTitle}" />` : ''}
        <span>${description}</span>
      </div>
    `;
    if ((i + 1) % 5 === 0) {
      htmlContent += '</div>';
    }
  });

  htmlContent += `
    </div> <!-- Closing parent div for all archetypes -->
    </page> <!-- Closing page element -->
    </body>
    </html>
  `;
  
  return htmlContent;
}

async function saveHTML(content, dir, filename) {
  try {
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(path.join(dir, filename), content, 'utf8');
    console.log(`HTML file created: ${path.join(dir, filename)}`);
  } catch (error) {
    console.error('Error saving HTML file:', error);
  }
}

(async () => {
  const url = `https://www.willclark.uk/${setVersion}-archetypes.html`;
  const dir = path.join(__dirname, 'sets');
  const filename = `${setVersion}.html`;

  try {
    const html = await fetchData(url);
    const archetypes = extractArchetypes(html); // Now includes titles and image titles
    const imageTitles = archetypes.map(archetype => archetype.imageTitle); // Create a list of image titles for image fetching
    const imagePaths = await fetchAndDownloadImages(imageTitles); // Fetch and download images
    const htmlContent = generateHTML(archetypes, imagePaths); // Pass image paths for matching
    await saveHTML(htmlContent, dir, filename);
  } catch (error) {
    console.error('Error in the overall process:', error);
  }
})();
