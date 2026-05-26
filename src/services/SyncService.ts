import { createClient } from '@supabase/supabase-js';
import type { LogiEntry } from '../types/projectTypes';

export class SyncService {
  private static clients: Map<string, any> = new Map();

  private static getClient(url: string, apiKey: string) {
    const key = `${url}-${apiKey}`;
    if (!this.clients.has(key)) {
      this.clients.set(key, createClient(url, apiKey));
    }
    return this.clients.get(key);
  }

  /**
   * Descarga las evidencias de Logi desde Supabase para un proyecto específico
   */
  static async fetchLogiEntries(url: string, apiKey: string, projectId: string, since?: number): Promise<LogiEntry[]> {
    try {
      const supabase = this.getClient(url, apiKey);
      
      let query = supabase
        .from('logi_evidences')
        .select('*')
        .eq('project_id', projectId);

      if (since) {
        // v2026-05-04: Filtro Delta (solo registros modificados después de 'since')
        query = query.gt('updated_at', new Date(since).toISOString());
      }

      const { data, error } = await query.order('fecha', { ascending: false });

      if (error) {
        console.error('Error fetching from Supabase:', error);
        throw error;
      }

      // Mapear el formato de BD al formato de la App
      return (data || []).map((row: any) => ({
        id: row.sync_id || row.id,
        date: row.fecha,
        itemCode: row.item_code || '',
        description: row.description || '',
        imageUrl: row.image_url,
        status: 'pending' // Por defecto al descargar son pendientes de integrar
      }));
    } catch (err) {
      console.error('Sync failed:', err);
      throw err;
    }
  }
}
