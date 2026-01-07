# Mumo Pipeline

A TypeScript-based data processing pipeline that transforms IoT sensor data from the MuMo project into Linked Data Event Streams (LDES) with SDS (Semantic Data Stream) formatting.

## Overview

This pipeline processes sensor data from MuMo (Multimodal Urban Mobility Observatory) devices, transforming raw IoT measurements into semantic RDF triples following established ontologies like SOSA (Semantic Sensor Network Ontology) and CIDOC-CRM. The system handles both sensor metadata and observation data, creating structured LDES outputs for further consumption.

## Pipeline Architecture

The pipeline consists of two parallel processing streams:

### Sensor Metadata Stream
- **MumoFetch** retrieves sensor metadata from `https://www.mumodashboard.be/history.php?sensors`
- **MumoMapper** transforms sensor JSON data to RDF using SOSA ontology
- **Sdsify** converts RDF to SDS records with `sosa:Platform` object type
- **Bucketize** organizes sensors by location using sensor location fragmentation
- **LdesDiskWriter** persists bucketized sensor data to `./ldes/sensors/`

### Observation Data Stream  
- **MumoFetch** retrieves measurement data from `https://www.mumodashboard.be/history.php?data`
- **MumoMapper** maps JSON measurements to RDF using CIDOC-CRM observations
- **Sdsify** converts to SDS records with `OM_Observation` object type
- **Bucketize** applies multi-dimensional fragmentation (location, sensor, time)
- **LdesDiskWriter** persists to `./ldes/data/`

## Key Features

- **Multi-sensor Support**: Handles various sensor types (BME680, TSL2591, SHT40, SCD40, etc.)
- **Semantic Mapping**: Transforms to standardized ontologies (SOSA, CIDOC-CRM, QUDT)
- **Configurable URLs**: Environment variables for data sources (`dataHistory`, `sensorHistory`, `groupHistory`)
- **State Management**: Persistent state tracking for incremental processing
- **LDES Output**: Creates proper Linked Data Event Streams for consumption

## Data Flow

1. Fetch raw JSON data from MuMo dashboard endpoints
2. Map to semantic RDF using device-specific transformations
3. Convert to SDS format with proper SHACL shapes
4. Apply bucketization strategies for efficient querying
5. Persist as LDES files for downstream consumption

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **RDF Processing**: N3.js, RDF/JS, Components.js
- **Pipeline Framework**: RDF Connect (rdfc) processors
- **Ontologies**: SOSA, CIDOC-CRM, QUDT, SHACL
- **Containerization**: Docker support

## Installation

```bash
npm install
npm run build
```

## Usage

Run the main pipeline:
```bash
npm start
# or
npx js-runner ./pipeline/pipeline.ttl
```

Start a Solid Community Server for LDES exposure:
```bash
npm run server
```

Development mode with TypeScript watching:
```bash
npm run watch
```

## Configuration

The pipeline uses environment variables for configuration:
- `dataHistory`: Data endpoint URL (default: https://www.mumodashboard.be/history.php?data)
- `sensorHistory`: Sensor endpoint URL (default: https://www.mumodashboard.be/history.php?sensors)  
- `groupHistory`: Groups endpoint URL (default: https://www.mumodashboard.be/history.php?groups)

## Docker Support

```bash
# Build and run with MongoDB
docker-compose -f docker-servers.yaml up mongo
```

## Output Structure

- `./ldes/sensors/`: Bucketized sensor metadata LDES
- `./ldes/data/`: Bucketized observation data LDES  
- `./state/`: Pipeline state files for incremental processing

## Authentication & Solid Server

This repository includes a Solid Community Server configuration with dynamic ACL generation based on MuMo dashboard groups.

### Auth Pipeline

Run the authentication pipeline:
```bash
npx js-runner ./pipeline/auth-pipeline.ttl
```

**Components:**
- **AclAuth**: Generates ACL files from dashboard user groups (port 7111)
- **CSS**: Serves LDES data with WebACL authorization 
- **WebId Builder**: Provides WebID and client credentials (port 3002)

**Configuration:**
- `baseUrl`: Server base URL (default: http://localhost:3000/)
- `userHistory`: Users endpoint (default: http://localhost:8080/history.php?users)
- `groupHistory`: Groups endpoint (default: http://localhost:8080/history.php?groups)
- `sensorHistory`: Sensors endpoint (default: http://localhost:8080/history.php?sensors)

**Security Model:**
- Protected paths: `/data/`, `/sensors/`
- Dynamic ACL generation from dashboard configuration
- WebACL-based authorization with DPoP bearer auth
