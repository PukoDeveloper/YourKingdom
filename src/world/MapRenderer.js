import { Container, Graphics, Sprite } from 'pixi.js';
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, CHUNK_SIZE } from './constants.js';
import { drawTile } from './TileDrawer.js';

/**
 * Renders the terrain by pre-baking each chunk into a RenderTexture-backed
 * Sprite. This gives a single draw-call per visible chunk.
 */
export class MapRenderer {
  /**
   * @param {import('pixi.js').Application} app
   * @param {import('./MapData.js').MapData} mapData
   * @param {(done: number, total: number) => void} [onProgress]
   */
  constructor(app, mapData, onProgress) {
    this.app        = app;
    this.mapData    = mapData;
    this.onProgress = onProgress ?? (() => {});
    /** Public container – add to the world container. */
    this.container  = new Container();
  }

  /**
   * Build all chunk sprites synchronously.
   * Call this once after the Pixi app has initialised.
   */
  build() {
    const chunksX = Math.ceil(MAP_WIDTH  / CHUNK_SIZE);
    const chunksY = Math.ceil(MAP_HEIGHT / CHUNK_SIZE);
    const total   = chunksX * chunksY;
    let   done    = 0;

    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        this._buildChunk(cx, cy);
        done++;
        this.onProgress(done, total);
      }
    }
  }

  _buildChunk(cx, cy) {
    const startTX = cx * CHUNK_SIZE;
    const startTY = cy * CHUNK_SIZE;
    const chunkW  = Math.min(CHUNK_SIZE, MAP_WIDTH  - startTX);
    const chunkH  = Math.min(CHUNK_SIZE, MAP_HEIGHT - startTY);

    const g = new Graphics();

    for (let ty = 0; ty < chunkH; ty++) {
      for (let tx = 0; tx < chunkW; tx++) {
        const terrain = this.mapData.getTerrain(startTX + tx, startTY + ty);
        drawTile(g, tx * TILE_SIZE, ty * TILE_SIZE, terrain);
      }
    }

    const texture = this.app.renderer.generateTexture(g);
    g.destroy();

    const sprite = new Sprite(texture);
    sprite.x = startTX * TILE_SIZE;
    sprite.y = startTY * TILE_SIZE;
    this.container.addChild(sprite);
  }
}
