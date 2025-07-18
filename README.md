# Masonry Layout Image Gallery
## Features

- User authentication (JWT-based)
- Upload multiple images (up to 5GB each)
- View images in a responsive masonry grid (Row format)
- Select and delete single or multiple images
- Protected upload/delete endpoints
- Search/filter images by tag or filename

### Prerequisites

- Node.js
- npm

### Installation
`npm install`

### Usage
1. Start the server: `node server.js`
2. For development with auo reload: `npm run devStart`
2. Open your browser and go to: [http://localhost:3000](http://localhost:3000).

### Default Login

- **Username:** abc
- **Password:** abc

## Project Structure

- `server.js` - Express server and API endpoints
- `public/` - Static frontend (HTML, CSS, JS)
- `uploads/` - Uploaded images (auto-created)
- `package.json` - Project dependencies and scripts

## API Endpoints

- `POST /api/login` - Authenticate and get JWT
- `POST /api/verify` - Verify JWT
- `GET /api/images` - List all images
- `POST /api/upload` - Upload images (auth required)
- `DELETE /api/images/:filename` - Delete image (auth required)