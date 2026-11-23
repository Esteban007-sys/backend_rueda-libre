import { query } from '../config/db.js';

export async function obtenerCatalogo() {
  const [sedesResult, bicicletasResult, recorridosResult] = await Promise.all([
    query('SELECT * FROM sedes ORDER BY id ASC'),
    query(
      `SELECT
        id,
        slug,
        modelo,
        tipo,
        precio_1hora,
        precio_mediodia,
        precio_diacompleto,
        stock_total,
        stock_disponible
      FROM bicicletas
      ORDER BY id ASC`
    ),
    query(
      `SELECT
        id,
        slug,
        nombre,
        modalidad,
        nivel,
        distancia_km,
        duracion_horas,
        precio_persona,
        cupos_diarios
      FROM recorridos
      ORDER BY id ASC`
    ),
  ]);

  return {
    sedes: sedesResult.rows,
    bicicletas: bicicletasResult.rows,
    recorridos: recorridosResult.rows,
    promociones: [
      {
        codigo: 'DESCUENTO_ELECTRICA_LUN_JUE_20',
        descripcion: '20% de descuento en alquiler de bicicletas eléctricas de lunes a jueves',
        porcentaje_descuento: 20,
        dias_aplicables: ['lunes', 'martes', 'miercoles', 'jueves'],
      },
    ],
  };
}
