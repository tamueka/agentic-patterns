// El patrón de diseño de uso de herramientas (Tool Use Design Pattern o 
// Function Calling) permite que un modelo de lenguaje (IA) interactúe con el 
// mundo exterior mediante la ejecución de funciones, APIs o bases de datos en 
// lugar de limitarse a generar texto estático.

/**
 * PATRÓN: Uso de herramientas - Tool use
 * ---------------------------
 * El catálogo de cursos NO está en el entrenamiento
 * del modelo. Sin herramientas, el modelo inventa precios y cursos con
 * total confianza o en su defecto, no hace nada.
 * Con herramientas, consulta el dato real.
 */

import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { createTracer, model } from '../../helpers/index.js';

// ---------------------------------------------------------------------------
//  LA "BASE DE DATOS" — datos que el modelo no puede conocer
// ---------------------------------------------------------------------------

type Course = {
    id: string;
    title: string;
    hours: number;
    priceUSD: number;
    level: 'basic' | 'intermediate' | 'advanced';
    students: number;
};

const COURSE_CATALOG: Course[] = [
    {
        id: 'ts-01',
        title: 'TypeScript desde cero',
        hours: 22,
        priceUSD: 19.99,
        level: 'basic',
        students: 48_120,
    },
    {
        id: 'nest-02',
        title: 'NestJS: API REST modular',
        hours: 31,
        priceUSD: 24.99,
        level: 'intermediate',
        students: 22_450,
    },
    {
        id: 'flu-03',
        title: 'Flutter: apps multiplataforma',
        hours: 46,
        priceUSD: 29.99,
        level: 'intermediate',
        students: 61_300,
    },
    {
        id: 'agt-04',
        title: 'Agentes de IA con TypeScript',
        hours: 18,
        priceUSD: 34.99,
        level: 'advanced',
        students: 1_890,
    },
    {
        id: 'dkr-05',
        title: 'Docker para desarrolladores',
        hours: 14,
        priceUSD: 17.99,
        level: 'basic',
        students: 35_770,
    },
];

const QUESTION = '¿Cuánto constarían juntos el curso de Typescript y el de Docker ' +
    ' con un 20% de descuento? Dame también las horas totales.';


async function whitoutTool() {
    const tracer = createTracer('sin-herramientas');
    const { text } = await generateText({
        model,
        prompt: QUESTION,
        onStepEnd: tracer.onStepFinish,
    })

    console.log('\n Respuesta: ', text.green);
    console.log('\n Verificar los numeros contra el catalogo de cursos');

    return tracer.summary();
}

// IMPLEMENTAR EL PATRON TOOL USE

// TOOL #1 FIND COURSES
const findCourses = tool({
    description: 'Buscar cursos en el catalogo de detalles, por texto, ' +
        'por titulo o por nivel. Utilizala siempre antes de responder ' +
        'cualquier pregunta sobre cursos, precios, cantidad de alumnos. ',
    inputSchema: z.object({
        text: z.string().optional().describe('Texto a buscar en el titulo del curso.'),
        level: z.enum(['basic', 'intermediate', 'advanced']).optional(),
    }),
    execute: async ({ text, level }) => {
        const filteredCourses = COURSE_CATALOG.filter((course) => {
            const matchesText = !text || course.title.toLowerCase().includes(text.toLowerCase())
            const matchesLevel = !level || course.level === level
            return matchesText && matchesLevel;
        });

        return {
            found: filteredCourses.length,
            courses: filteredCourses
        }
    }
});


// TOOL #2 CALCULATE TOTAL
const calculateTotal = tool({
    description: 'Calcula el precio total de una lista de cursos aplicando un descuento porcentual. ' +
        ' Utilizala siempre para cualquier operacion aritmetica: no calcules mentalmente',
    inputSchema: z.object({
        ids: z.array(z.string()).describe('IDs de los cursos. ej: ["ts-01", "dkr-0523"]'),
        discountPercent: z.number().min(0).max(100).default(0)
    }),
    execute: async ({ ids, discountPercent }) => {

        const foundCourses = COURSE_CATALOG.filter(course => ids.includes(course.id))

        const notFound = ids.filter((id) => {
            !COURSE_CATALOG.some(course => course.id === id)
        })

        const subTotal = foundCourses.reduce((acc, course) => acc + course.priceUSD, 0)

        const discount = subTotal * (discountPercent / 100)

        return {
            subTotal: Number(subTotal.toFixed(2)),
            discount: Number(discount.toFixed(2)),
            total: Number((subTotal - discount).toFixed(2)),
            notFound: notFound
        }

    }
});

async function whitTool() {
    const tracer = createTracer('con-herramientas');
    const { text } = await generateText({
        model,
        prompt: QUESTION,
        tools: { findCourses, calculateTotal },
        // Patron Circuit Breaker
        stopWhen: stepCountIs(6),
        instructions: 'Eres un asistente del catalogo de cursos de detalles. ' +
            ' No inventes precios, duraciones ni nombres de cursos. ' +
            ' Consultalos siempre con lsa herramientas disponibles. ',
        onStepEnd: tracer.onStepFinish,
    })

    console.log('\n Respuesta: ', text.green);
    console.log('\n Verificar los numeros contra el catalogo de cursos');

    return tracer.summary();
}

export async function toolUseMain() {
    // const resultA = await whitoutTool();
    const resultB = await whitTool();

    console.log('\n === Comparativa ===');
    console.table({
        // 'Sin herramientas': resultA,
        'Con herramientas': resultB,
    });
}

