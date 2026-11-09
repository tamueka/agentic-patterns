/**
 * PATRÓN: Paralelización - Parallelization
 * ----------------------------------------
 * Tres fases, cada una con un responsable claro:
 *
 *   1. PLANIFICAR  → un agente lee la petición y devuelve una lista de
 *                    investigaciones independientes (salida estructurada).
 *   2. EJECUTAR    → un worker por investigación, todos a la vez.
 *   3. INTEGRAR    → un agente recibe los hallazgos y redacta la salida.
 *
 * Lo que compra: latencia. Cuatro investigaciones tardan lo que tarda la
 * más lenta, no la suma de las cuatro.
 *
 * El coste oculto: los workers no se ven entre sí. Un multiplataforma
 * aparece en varias ramas y nadie puede evitarlo desde dentro. Por eso
 * la fase 3 no es opcional.
 *
 *   A) UN SOLO AGENTE  → busca y redacta él mismo, en serie.
 *   B) PLAN + FAN-OUT + INTEGRACIÓN
 *
 * REQUISITOS
 *   - Clave gratuita de RAWG: https://rawg.io/apidocs
 *   - export RAWG_API_KEY="..."
 */


import { generateText, Output, stepCountIs, tool } from 'ai';
import dotenv from 'dotenv';
import { z } from 'zod';
import { createTracer, model } from '../../helpers/index.js';
;

// Cargar las variables del archivo .env al inicio de todo
dotenv.config();

const RESEARCH_REQUEST =
    'Quiero saber en los próximos 90 días, qué juegos vienen para ' +
    'Nintendo, PC, PlayStation y XBOX';

// ---------------------------------------------------------------------------
// AUTENTICACIÓN Y CONFIGURACIÓN DE IGDB
// ---------------------------------------------------------------------------

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID ?? '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET ?? '';

/**
 * Función para obtener automáticamente el token de acceso usando OAuth de Twitch
 */
async function getAccessToken(): Promise<string> {
    const url = `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`;
    const response = await fetch(url, { method: 'POST' });

    if (!response.ok) {
        throw new Error(`Error al obtener el token de Twitch: ${response.statusText}`);
    }

    const data = (await response.json()) as { access_token: string };
    return data.access_token;
}

/**
 * IDs de plataformas en IGDB:
 * - PC (Microsoft Windows): 6
 * - PlayStation: 48 (PS4), 167 (PS5)
 * - XBOX: 49 (Xbox One), 169 (Xbox Series X/S)
 * - Nintendo: 130 (Nintendo Switch)
 */
const PLATFORMS = {
    pc: [6],
    playstation: [48, 167],
    xbox: [49, 169],
    nintendo: [130],
} as const;

type Platform = keyof typeof PLATFORMS;

// ---------------------------------------------------------------------------
// LA HERRAMIENTA DE BÚSQUEDA EN IGDB
// ---------------------------------------------------------------------------

const searchUpcomingGames = tool({
    description:
        'Busca los videojuegos que salen en una plataforma dentro de una ' +
        'ventana de días en IGDB, ordenados por relevancia. Úsala antes de responder: ' +
        'no inventes títulos ni fechas.',
    inputSchema: z.object({
        platform: z.enum(['pc', 'playstation', 'xbox', 'nintendo']),
        days: z.number().min(1).max(365).default(90),
        limit: z.number().min(3).max(20).default(10),
    }),
    execute: async ({ platform, days, limit }) => {
        try {
            const accessToken = await getAccessToken();

            const nowUnix = Math.floor(Date.now() / 1000);
            const futureUnix = Math.floor((Date.now() + days * 86_400_000) / 1000);
            const platformIds = PLATFORMS[platform as Platform].join(',');

            // Lenguaje de consultas Apicalypse de IGDB
            const query = `
                fields name, first_release_date, total_rating_count;
                where first_release_date >= ${nowUnix} & first_release_date <= ${futureUnix} & platforms = (${platformIds});
                sort first_release_date asc;
                limit ${limit};
            `;

            const response = await fetch('https://api.igdb.com/v4/games', {
                method: 'POST',
                headers: {
                    'Client-ID': TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'text/plain',
                },
                body: query,
            });

            if (!response.ok) {
                return { error: `IGDB respondió ${response.status}: ${response.statusText}` };
            }

            const games = (await response.json()) as {
                id: number;
                name: string;
                first_release_date?: number;
                total_rating_count?: number;
            }[];

            return {
                platform,
                games: games.map((game) => ({
                    title: game.name,
                    released: game.first_release_date
                        ? new Date(game.first_release_date * 1000).toISOString().slice(0, 10)
                        : 'Fecha por confirmar',
                    hype: game.total_rating_count ?? 0,
                })),
            };
        } catch (error: any) {
            return { error: error.message };
        }
    },
});

// ---------------------------------------------------------------------------
// A) UN SOLO AGENTE — busca y redacta él mismo
// ---------------------------------------------------------------------------

async function singleAgent() {
    console.log('\n═══ A) UN SOLO AGENTE ═══\n');
    const tracer = createTracer('agente-único');
    const startedAt = Date.now();

    const { text } = await generateText({
        model,
        tools: { searchUpcomingGames },
        stopWhen: stepCountIs(8),
        system:
            'Eres un investigador de videojuegos. Consulta la herramienta ' +
            'para buscar los lanzamientos de Nintendo, PC, PlayStation y XBOX, ' +
            'y redacta un informe ordenado en español.',
        prompt: RESEARCH_REQUEST,
        onStepEnd: tracer.onStepFinish
    });

    console.log(text.green);

    return { ...tracer.summary(), ms: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// B) PLANIFICAR → EJECUTAR EN PARALELO → INTEGRAR
// ---------------------------------------------------------------------------

const planSchema = z.object({
    tasks: z.array(
        z.object({
            topic: z.string().describe('Plataforma o temática de la investigación'),
            assignment: z.string().describe('Instrucciones completas y autocontenidas para el worker'),
        })
    ).min(1)
        .max(8)
        .describe('Investigaciones independientes entre si')
});

async function planResearch(tracer: ReturnType<typeof createTracer>) {
    const { output } = await generateText({
        model,
        output: Output.object({ schema: planSchema }),
        instructions: `Analiza la siguiente petición y divide la investigación en tareas 
        independientes por plataforma (Nintendo, PC, PlayStation, XBOX)`,
        prompt: RESEARCH_REQUEST,
        onStepEnd: tracer.onStepFinish
    });
    return output.tasks;
}

async function runWorker(assignment: string, tracer: ReturnType<typeof createTracer>) {
    const { text } = await generateText({
        model,
        tools: { searchUpcomingGames },
        stopWhen: stepCountIs(4),
        instructions:
            'Eres un investigador de videojuegos. Cumple tu encargo consultando ' +
            'la herramienta y responde con una lista breve: título, fecha y una ' +
            'frase de por qué importa. Copia títulos y fechas literalmente. ' +
            'Responde en español.',
        prompt: assignment,
        onStepEnd: tracer.onStepFinish
    });
    return text;
}

async function integrateFindings(findings: { topic: string; findings: string }[], tracer: ReturnType<typeof createTracer>) {
    const findingsText = findings
        .map((f) => `### ${f.topic}\n${f.findings}`)
        .join('\n\n');

    const { text } = await generateText({
        model,
        instructions:
            'Eres editor de una newsletter de videojuegos. Integra los hallazgos ' +
            'en un repaso de máximo 200 palabras. Si un juego aparece en varios ' +
            'temas, menciónalo UNA sola vez indicando todas sus plataformas. ' +
            'Responde en español.',
        prompt:
            `Peticion orginal:\n\n${RESEARCH_REQUEST}\n\n` +
            'Hallazgos por tema: \n' +
            // findings.map((item) => ` ---- ${item.topic} --- \n ${item.findings}`).join('\n\n'),
            JSON.stringify(findings),
        onStepEnd: tracer.onStepFinish
    });
    return text;
}

async function planExecuteIntegrate() {
    console.log('\n═══ B) PLAN → PARALELO → INTEGRACIÓN ═══\n');

    const tracer = createTracer('paralelo');
    const startedAt = Date.now();

    // 1. Planificar
    const tasks = await planResearch(tracer);
    console.log(` Plan: ${tasks.length} investigaciones`);
    for (const task of tasks) {
        console.log(`   · ${task.topic}: ${task.assignment}`);
    }

    // 2. Ejecutar en paralelo
    const workersStartedAt = Date.now();
    const workerPromises = tasks.map((task) =>
        runWorker(task.assignment, tracer).then((findings) => ({
            topic: task.topic,
            findings,
        }))

    );
    const findings = await Promise.all(workerPromises);
    const workersMs = Date.now() - workersStartedAt;

    // 3. Integrar
    const report = await integrateFindings(findings, tracer);

    console.log('\n Informe integrado:\n');
    console.log(report);

    return {
        ...tracer.summary(),
        ms: Date.now() - startedAt,
        workersMs,
        workers: tasks.length,
    };
}

// ---------------------------------------------------------------------------
// EJECUCIÓN DEL PROGRAMA
// ---------------------------------------------------------------------------

export async function parallelizationMain() {
    if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
        console.error(
            '\n   Faltan TWITCH_CLIENT_ID o TWITCH_CLIENT_SECRET en el archivo .env\n',
        );
        return;
    }

    // const a = await singleAgent();
    const b = await planExecuteIntegrate();

    console.log('\n═══ COMPARATIVA ═══\n');
    console.table({
        // 'A) Agente único': a,
        'B) Plan + paralelo + integración': b,
    });
}