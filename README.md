# Drawit - AI-Powered Collaborative Whiteboard

A real-time collaborative drawing and diagramming application with AI-powered diagram generation. Built with Next.js 16, React 19, and the Vercel AI SDK.

## Features

### Canvas Tools
- **Selection & Pan** - Select shapes or pan around the infinite canvas
- **Shapes** - Rectangle, ellipse, diamond, arrow, line, freehand drawing
- **Text** - Add text labels with customizable fonts and alignment
- **Images** - Upload and place images on the canvas
- **Smart Connectors** - Connect shapes with automatic routing (bezier, smoothstep, straight)
- **Eraser** - Remove elements from the canvas

### AI-Powered Diagram Generation
Chat with the AI assistant to create complex diagrams:

- **Flowcharts** - Process flows, decision trees, swimlane diagrams
- **Workflows** - n8n-style automation diagrams with triggers, actions, conditions
- **Mind Maps** - Brainstorming and idea organization
- **Org Charts** - Team hierarchy and organizational structures
- **ER Diagrams** - Database entity-relationship diagrams
- **Network Diagrams** - Infrastructure topology (tree, circular, grid layouts)
- **Molecular Structures** - Chemical formulas (H2O, CO2, CH4, etc.)

### Customization
- **Dark/Light Theme** - Toggle between themes
- **Style Properties** - Stroke color, fill color, width, style (solid/dashed/dotted)
- **Roughness** - Adjust hand-drawn appearance (architect, artist, cartoonist)
- **Opacity** - Control transparency of elements

### Export
- Export diagrams as PNG or SVG
- Copy to clipboard

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui
- **AI**: Vercel AI SDK v5 with Claude/GPT models
- **Storage**: Vercel Blob for chat history & image uploads
- **Drawing**: Custom SVG-based canvas with smart connectors

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm (recommended) or npm

### Environment Variables
```bash
# AI Gateway (required for AI features)
AI_GATEWAY_API_KEY=your_api_key

# Vercel Blob (for chat history persistence & image uploads)
BLOB_READ_WRITE_TOKEN=your_blob_token
```

### Installation
```bash
# Clone the repository
git clone https://github.com/WebRenew/drawit.git
cd drawit

# Install dependencies
pnpm install

# Run development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to start drawing.

## Project Structure
```
├── app/
│   ├── api/
│   │   ├── ai-chat/        # AI chat endpoint with tool definitions
│   │   ├── chat-history/   # Chat history persistence
│   │   └── upload/         # Image upload handling
│   ├── workflow/           # Workflow builder page
│   └── page.tsx            # Main canvas page
├── components/
│   ├── ai-chat/            # AI chat panel components
│   ├── editor/             # Canvas and toolbar components
│   ├── workflow/           # Workflow builder components
│   └── ui/                 # shadcn/ui components
├── lib/
│   ├── ai-chat/
│   │   └── tool-handlers/  # AI tool execution handlers
│   ├── *-layouts.ts        # Layout algorithms for diagrams
│   ├── store.ts            # Zustand state management
│   └── types.ts            # TypeScript type definitions
└── scripts/
    └── 001_init.sql        # Database initialization
```

## AI Tools

The AI assistant supports the following tools:

| Tool | Description |
|------|-------------|
| `getCanvasState` | Get current canvas elements and connections |
| `createFlowchart` | Create flowcharts with connected nodes |
| `createWorkflow` | Create n8n-style workflow automations |
| `createMindMap` | Create mind maps for brainstorming |
| `createOrgChart` | Create organizational hierarchy charts |
| `createERDiagram` | Create database ER diagrams |
| `createNetworkDiagram` | Create network infrastructure diagrams |
| `createMolecule` | Create molecular structure diagrams |
| `createShape` | Create basic shapes (rectangle, circle, etc.) |
| `updateShape` | Modify existing shape properties |
| `placeImage` | Place an image on the canvas |
| `clearCanvas` | Clear all canvas content |
| `analyzeDiagram` | Analyze and provide insights on current diagram |
| `beautifyDiagram` | Auto-arrange diagram layout |

## Usage Examples

### Create a Flowchart
```
"Create a user authentication flowchart with login, validation, and success/failure paths"
```

### Create an Org Chart
```
"Create an org chart with John as CEO, with 3 VPs reporting to him"
```

### Recreate from Image
Upload an image of a diagram and ask:
```
"Recreate this diagram on the canvas"
```

### Create a Molecular Structure
```
"Draw a water molecule (H2O)"
```

## License

MIT