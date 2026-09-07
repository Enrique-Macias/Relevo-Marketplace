/**
 * Publicaciones de prueba. Shape desacoplado a propósito de
 * `database.types.ts` (que refleja `public.listings` tal cual está en
 * remoto) — este es un mock de UI, no un stand-in 1:1 del schema; cuando se
 * conecte Supabase, cada pantalla cambia su `fetch` sin que este archivo siga
 * existiendo.
 */

export type Condicion = 'nuevo' | 'como_nuevo' | 'buen_estado' | 'usado';

export type Vendedor = {
  id: string;
  nombre: string;
  iniciales: string;
  carrera: string;
  ventas: number;
  verificado: boolean;
};

export type Listing = {
  id: string;
  categoriaId: string;
  titulo: string;
  descripcion: string;
  precio: number;
  condicion: Condicion;
  createdAt: Date;
  vistasCount: number;
  favoritosCount: number;
  contactosCount: number;
  campus: string;
  vendedor: Vendedor;
};

export const USUARIO_ACTUAL = { id: 'me', nombre: 'Enrique M.', iniciales: 'EM' };

const JORGE: Vendedor = {
  id: 'u-jorge',
  nombre: 'Jorge Muñoz',
  iniciales: 'JM',
  carrera: 'Ingeniería Industrial',
  ventas: 12,
  verificado: true,
};
const ANA: Vendedor = {
  id: 'u-ana',
  nombre: 'Ana Torres',
  iniciales: 'AT',
  carrera: 'Diseño Industrial',
  ventas: 5,
  verificado: true,
};
const LUIS: Vendedor = {
  id: 'u-luis',
  nombre: 'Luis Peña',
  iniciales: 'LP',
  carrera: 'Ingeniería en Sistemas',
  ventas: 3,
  verificado: false,
};
const YO: Vendedor = {
  id: USUARIO_ACTUAL.id,
  nombre: USUARIO_ACTUAL.nombre,
  iniciales: USUARIO_ACTUAL.iniciales,
  carrera: 'Ingeniería Biomédica',
  ventas: 4,
  verificado: true,
};

const horasAtras = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
const CAMPUS_DEFAULT = 'Tec de Monterrey';

export const LISTINGS: Listing[] = [
  {
    id: 'l1',
    categoriaId: 'libros',
    titulo: 'Cálculo de Larson, 9a edición',
    descripcion:
      'Libro de cálculo diferencial e integral, 9a edición. Sin subrayados ni marcas, pasta en buen estado. Lo usé para la materia de Cálculo I, ya no lo necesito. Precio negociable, entrega en el campus.',
    precio: 280,
    condicion: 'como_nuevo',
    createdAt: horasAtras(2),
    vistasCount: 48,
    favoritosCount: 6,
    contactosCount: 3,
    campus: CAMPUS_DEFAULT,
    vendedor: JORGE,
  },
  {
    id: 'l2',
    categoriaId: 'electronica',
    titulo: 'Monitor Dell 24" IPS',
    descripcion:
      'Monitor Dell de 24 pulgadas, panel IPS, Full HD. Funciona perfecto, lo vendo porque me compré uno más grande. Incluye cable HDMI y de poder.',
    precio: 3200,
    condicion: 'buen_estado',
    createdAt: horasAtras(5),
    vistasCount: 31,
    favoritosCount: 4,
    contactosCount: 2,
    campus: CAMPUS_DEFAULT,
    vendedor: ANA,
  },
  {
    id: 'l3',
    categoriaId: 'muebles',
    titulo: 'Escritorio plegable',
    descripcion:
      'Escritorio plegable ideal para dorm o cuarto de renta. Fácil de guardar, aguanta laptop y monitor sin problema. Poco uso.',
    precio: 650,
    condicion: 'buen_estado',
    createdAt: horasAtras(24),
    vistasCount: 19,
    favoritosCount: 1,
    contactosCount: 0,
    campus: CAMPUS_DEFAULT,
    vendedor: LUIS,
  },
  {
    id: 'l4',
    categoriaId: 'ropa',
    titulo: 'Sudadera Tec talla M',
    descripcion: 'Sudadera oficial del Tec, talla M, nueva sin etiquetas. Compré talla equivocada.',
    precio: 180,
    condicion: 'nuevo',
    createdAt: horasAtras(30),
    vistasCount: 22,
    favoritosCount: 3,
    contactosCount: 1,
    campus: CAMPUS_DEFAULT,
    vendedor: ANA,
  },
  {
    id: 'l5',
    categoriaId: 'otros',
    titulo: 'Reloj Casio G-Shock',
    descripcion: 'Reloj Casio G-Shock, resistente al agua, pila nueva. Poco uso, solo lo traigo dos veces.',
    precio: 1450,
    condicion: 'como_nuevo',
    createdAt: horasAtras(48),
    vistasCount: 27,
    favoritosCount: 2,
    contactosCount: 1,
    campus: CAMPUS_DEFAULT,
    vendedor: JORGE,
  },
  {
    id: 'l6',
    categoriaId: 'deportes',
    titulo: 'Balón de fútbol #5',
    descripcion: 'Balón de fútbol talla 5, marca Wilson, usado en un semestre de liga interna. Buen estado.',
    precio: 220,
    condicion: 'usado',
    createdAt: horasAtras(72),
    vistasCount: 14,
    favoritosCount: 0,
    contactosCount: 0,
    campus: CAMPUS_DEFAULT,
    vendedor: LUIS,
  },
  {
    id: 'l7',
    categoriaId: 'libros',
    titulo: 'Cálculo vectorial, Stewart',
    descripcion: 'Libro de cálculo vectorial de Stewart. Algunas notas a lápiz en los primeros capítulos, se borran fácil.',
    precio: 350,
    condicion: 'usado',
    createdAt: horasAtras(4),
    vistasCount: 12,
    favoritosCount: 1,
    contactosCount: 0,
    campus: CAMPUS_DEFAULT,
    vendedor: ANA,
  },
  {
    id: 'l8',
    categoriaId: 'libros',
    titulo: 'Física para ciencias, Serway',
    descripcion: 'Física para ciencias e ingeniería, Serway. Pasta un poco maltratada pero todas las hojas completas.',
    precio: 150,
    condicion: 'usado',
    createdAt: horasAtras(6),
    vistasCount: 9,
    favoritosCount: 0,
    contactosCount: 0,
    campus: CAMPUS_DEFAULT,
    vendedor: LUIS,
  },
  {
    id: 'l9',
    categoriaId: 'libros',
    titulo: 'Contabilidad financiera, Warren',
    descripcion: 'Contabilidad financiera de Warren, edición reciente. Como nuevo, se usó solo un semestre.',
    precio: 420,
    condicion: 'nuevo',
    createdAt: horasAtras(26),
    vistasCount: 17,
    favoritosCount: 2,
    contactosCount: 1,
    campus: CAMPUS_DEFAULT,
    vendedor: JORGE,
  },
  {
    id: 'l10',
    categoriaId: 'hogar',
    titulo: 'Set de vasos y platos',
    descripcion: 'Set de 6 vasos y 6 platos para depa/dorm. Se venden juntos, buen estado, sin cachaduras.',
    precio: 300,
    condicion: 'buen_estado',
    createdAt: horasAtras(50),
    vistasCount: 8,
    favoritosCount: 1,
    contactosCount: 0,
    campus: CAMPUS_DEFAULT,
    vendedor: ANA,
  },
  {
    id: 'l11',
    categoriaId: 'apuntes',
    titulo: 'Apuntes completos de Cálculo I',
    descripcion: 'Apuntes a mano, completos, del semestre con el profesor Ibarra. Incluyen ejercicios resueltos.',
    precio: 120,
    condicion: 'buen_estado',
    createdAt: horasAtras(10),
    vistasCount: 15,
    favoritosCount: 2,
    contactosCount: 1,
    campus: CAMPUS_DEFAULT,
    vendedor: LUIS,
  },
  {
    id: 'l12',
    categoriaId: 'instrumentos',
    titulo: 'Guitarra acústica Yamaha',
    descripcion: 'Guitarra acústica Yamaha, cuerdas nuevas, viene con funda. Ideal para empezar a tocar.',
    precio: 1800,
    condicion: 'buen_estado',
    createdAt: horasAtras(60),
    vistasCount: 21,
    favoritosCount: 3,
    contactosCount: 2,
    campus: CAMPUS_DEFAULT,
    vendedor: JORGE,
  },
  {
    id: 'l13',
    categoriaId: 'papeleria',
    titulo: 'Kit de plumones para dibujo técnico',
    descripcion: 'Kit de plumones de punta fina para dibujo técnico, usado en un curso de diseño. Casi completo.',
    precio: 250,
    condicion: 'como_nuevo',
    createdAt: horasAtras(15),
    vistasCount: 6,
    favoritosCount: 0,
    contactosCount: 0,
    campus: CAMPUS_DEFAULT,
    vendedor: ANA,
  },
  {
    id: 'l14',
    categoriaId: 'boletos-y-eventos',
    titulo: 'Boleto concierto Auditorio Banamex',
    descripcion: 'Boleto general para concierto en el Auditorio Banamex, no puedo ir por examen. Entrega digital.',
    precio: 900,
    condicion: 'nuevo',
    createdAt: horasAtras(3),
    vistasCount: 40,
    favoritosCount: 5,
    contactosCount: 4,
    campus: CAMPUS_DEFAULT,
    vendedor: LUIS,
  },
  {
    id: 'l15',
    categoriaId: 'arte-y-manualidades',
    titulo: 'Set de pinturas acrílicas',
    descripcion: 'Set de 24 pinturas acrílicas, usadas solo en un proyecto de la materia de Arte. Casi llenas.',
    precio: 200,
    condicion: 'usado',
    createdAt: horasAtras(80),
    vistasCount: 5,
    favoritosCount: 0,
    contactosCount: 0,
    campus: CAMPUS_DEFAULT,
    vendedor: ANA,
  },
  // Publicaciones propias — para probar el estado "vista vendedor" de Detalle sin backend.
  {
    id: 'l16',
    categoriaId: 'electronica',
    titulo: 'Audífonos Sony WH-CH520',
    descripcion: 'Audífonos inalámbricos Sony, poco uso, batería dura todo el día. Incluyen cable de carga original.',
    precio: 750,
    condicion: 'como_nuevo',
    createdAt: horasAtras(2),
    vistasCount: 48,
    favoritosCount: 6,
    contactosCount: 3,
    campus: CAMPUS_DEFAULT,
    vendedor: YO,
  },
  {
    id: 'l17',
    categoriaId: 'muebles',
    titulo: 'Silla gamer usada',
    descripcion: 'Silla gamer, cómoda para estudiar, algunos signos de uso en los brazos pero estructura sólida.',
    precio: 1100,
    condicion: 'usado',
    createdAt: horasAtras(36),
    vistasCount: 12,
    favoritosCount: 1,
    contactosCount: 1,
    campus: CAMPUS_DEFAULT,
    vendedor: YO,
  },
];

export function getListingById(id: string): Listing | undefined {
  return LISTINGS.find((l) => l.id === id);
}

export function getListingsByCategoria(categoriaId: string): Listing[] {
  return LISTINGS.filter((l) => l.categoriaId === categoriaId);
}
