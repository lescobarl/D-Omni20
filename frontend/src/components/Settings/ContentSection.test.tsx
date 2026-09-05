import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentSection } from '@/components/Settings/ContentSection';
import {
  setDocumentService,
  setSynonymService,
  setTenantConfigService,
  useTenantConfigStore,
} from '@/store/tenantConfigStore';
import {
  makeContentItem,
  makeDocumentContentRead,
  makeDocumentSearchResult,
  makeDocumentService,
  makeIngestResult,
  makePage,
  makeService,
  makeSynonym,
  makeSynonymService,
} from '@/test/tenantConfigMocks';
import type { ISynonymCreate, ISynonymUpdate } from '@/api/types';

describe('ContentSection', () => {
  beforeEach(() => {
    useTenantConfigStore.getState().reset();
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    useTenantConfigStore.getState().reset();
    setDocumentService(null);
    setSynonymService(null);
    setTenantConfigService(null);
    document.documentElement.removeAttribute('style');
    vi.restoreAllMocks();
  });

  it('muestra el estado vacío cuando no hay contenido configurado', async () => {
    const service = makeService();
    setTenantConfigService(service);

    render(<ContentSection />);

    expect(await screen.findByText('Aún no hay contenido configurado.')).toBeInTheDocument();
    expect(service.listContentItems).toHaveBeenCalledTimes(1);
  });

  it('valida el título obligatorio sin llamar al servicio', async () => {
    const service = makeService();
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByRole('form', { name: 'Crear ítem de contenido' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear ítem' }));
    });

    expect(screen.getByText('El título es obligatorio.')).toBeInTheDocument();
    expect(service.createContentItem).not.toHaveBeenCalled();
  });

  it('crea un ítem de contenido con todos los campos', async () => {
    const service = makeService();
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByRole('form', { name: 'Crear ítem de contenido' });
    await user.type(screen.getByLabelText('Título'), '¿Cómo recupero mi contraseña?');
    await user.type(screen.getByLabelText('Respuesta / cuerpo'), 'Ve a la sección de seguridad…');
    await user.type(screen.getByLabelText('Etiquetas (separadas por comas)'), 'cuenta, contraseña');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear ítem' }));
    });

    expect(service.createContentItem).toHaveBeenCalledWith({
      kind: 'faq',
      title: '¿Cómo recupero mi contraseña?',
      content: 'Ve a la sección de seguridad…',
      tags: ['cuenta', 'contraseña'],
    });
  });

  it('crea un ítem solo con título omitiendo contenido y etiquetas', async () => {
    const service = makeService();
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByRole('form', { name: 'Crear ítem de contenido' });
    await user.type(screen.getByLabelText('Título'), 'Pregunta frecuente sin cuerpo');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Crear ítem' }));
    });

    expect(service.createContentItem).toHaveBeenCalledWith({
      kind: 'faq',
      title: 'Pregunta frecuente sin cuerpo',
      content: undefined,
      tags: [],
    });
  });

  it('edita un ítem existente precargando el formulario', async () => {
    const service = makeService({
      listContentItems: async () => makePage([makeContentItem()]),
    });
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByText('¿Cómo funcionan los envíos?');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByRole('form', { name: 'Editar ítem de contenido' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar edición' })).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveValue('¿Cómo funcionan los envíos?');

    await user.clear(screen.getByLabelText('Título'));
    await user.type(screen.getByLabelText('Título'), 'Título actualizado');

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    });

    expect(service.updateContentItem).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', {
      kind: 'faq',
      title: 'Título actualizado',
      content: 'Respuesta de prueba',
      tags: ['ventas'],
    });
  });

  it('elimina un ítem de contenido', async () => {
    const service = makeService({
      listContentItems: async () => makePage([makeContentItem()]),
    });
    setTenantConfigService(service);
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByText('¿Cómo funcionan los envíos?');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteContentItem).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
  });

  it('muestra el error de carga de forma accesible', async () => {
    const service = makeService({
      listContentItems: async () => {
        throw 'x';
      },
    });
    setTenantConfigService(service);

    render(<ContentSection />);

    expect(await screen.findByText('No se pudo cargar el contenido.')).toBeInTheDocument();
  });

  it('muestra el estado vacío de documentos cuando no hay documentos ingeridos', async () => {
    const service = makeDocumentService({
      listDocuments: vi.fn().mockResolvedValue(makePage([])),
    });
    setDocumentService(service);
    setTenantConfigService(makeService());

    render(<ContentSection />);

    expect(await screen.findByText('Aún no hay documentos ingeridos.')).toBeInTheDocument();
    expect(service.listDocuments).toHaveBeenCalledTimes(1);
  });

  it('valida los campos de ingesta sin llamar al servicio', async () => {
    const service = makeDocumentService({
      listDocuments: vi.fn().mockResolvedValue(makePage([])),
    });
    setDocumentService(service);
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByText('Aún no hay documentos ingeridos.');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ingerir archivo' }));
    });
    expect(
      screen.getByText('Selecciona un archivo PDF, TXT o CSV para ingerir.'),
    ).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ingerir URL' }));
    });
    expect(screen.getByText('Introduce una URL pública del documento.')).toBeInTheDocument();
    expect(service.ingestDocumentFile).not.toHaveBeenCalled();
    expect(service.ingestDocumentUrl).not.toHaveBeenCalled();
  });

  it('ingiere un archivo y muestra el documento creado', async () => {
    const service = makeDocumentService({
      listDocuments: async () => makePage([]),
      ingestDocumentFile: vi.fn().mockResolvedValue(
        makeIngestResult({
          document: makeDocumentContentRead({
            id: '66666666-6666-4666-8666-666666666666',
            title: 'Manual de políticas',
            source_type: 'txt',
          }),
        }),
      ),
    });
    setDocumentService(service);
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    const file = new File(['contenido'], 'politicas.txt', { type: 'text/plain' });
    await act(async () => {
      await user.upload(screen.getByLabelText('Archivo (PDF, TXT o CSV)'), file);
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ingerir archivo' }));
    });

    expect(service.ingestDocumentFile).toHaveBeenCalledWith(file);
    expect(await screen.findByText('Manual de políticas')).toBeInTheDocument();
  });

  it('ingiere una URL y muestra el documento creado', async () => {
    const service = makeDocumentService({
      listDocuments: async () => makePage([]),
      ingestDocumentUrl: vi.fn().mockResolvedValue(
        makeIngestResult({
          document: makeDocumentContentRead({
            id: '66666666-6666-4666-8666-666666666666',
            title: 'Manual de políticas',
            source_type: 'url',
          }),
        }),
      ),
    });
    setDocumentService(service);
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await user.type(screen.getByLabelText('URL del documento'), 'https://ejemplo.com/manual.pdf');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ingerir URL' }));
    });

    expect(service.ingestDocumentUrl).toHaveBeenCalledWith({
      url: 'https://ejemplo.com/manual.pdf',
    });
    expect(await screen.findByText('Manual de políticas')).toBeInTheDocument();
  });

  it('busca en la base de conocimiento y muestra los resultados con relevancia', async () => {
    const service = makeDocumentService({
      listDocuments: async () => makePage([]),
      searchDocuments: vi.fn().mockResolvedValue([
        makeDocumentSearchResult({
          document_id: '66666666-6666-4666-8666-666666666666',
          title: 'Manual de políticas',
          snippet: 'Fragmento de políticas de reembolso…',
        }),
      ]),
    });
    setDocumentService(service);
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await user.type(screen.getByPlaceholderText('¿Qué tema quieres buscar?'), 'reembolso');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
    });

    expect(service.searchDocuments).toHaveBeenCalledWith('reembolso');
    expect(await screen.findByText('Manual de políticas')).toBeInTheDocument();
    expect(screen.getByText('Fragmento de políticas de reembolso…')).toBeInTheDocument();
    expect(screen.getByText('Relevancia: 0.95')).toBeInTheDocument();
  });

  it('expande y oculta el contenido de un documento ingerido', async () => {
    const service = makeDocumentService();
    setDocumentService(service);
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByText('Manual de usuario');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ver' }));
    });

    expect(service.getDocument).toHaveBeenCalledWith('55555555-5555-4555-8555-555555555555');
    expect(
      await screen.findByText('Contenido de prueba del manual de usuario.'),
    ).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Ocultar' }));
    });
    expect(
      screen.queryByText('Contenido de prueba del manual de usuario.'),
    ).not.toBeInTheDocument();
  });

  it('elimina un documento ingerido', async () => {
    const service = makeDocumentService();
    setDocumentService(service);
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByText('Manual de usuario');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(service.deleteDocument).toHaveBeenCalledWith('55555555-5555-4555-8555-555555555555');
    expect(await screen.findByText('Aún no hay documentos ingeridos.')).toBeInTheDocument();
  });

  it('muestra el error de carga de documentos de forma accesible', async () => {
    const service = makeDocumentService({
      listDocuments: async () => {
        throw 'x';
      },
    });
    setDocumentService(service);
    setTenantConfigService(makeService());

    render(<ContentSection />);

    expect(await screen.findByText('No se pudieron cargar los documentos.')).toBeInTheDocument();
  });

  it('muestra los sinónimos agrupados por término', async () => {
    const synonymService = makeSynonymService({
      listSynonyms: vi.fn().mockResolvedValue(
        makePage([
          makeSynonym({ term: 'automóvil', synonyms: ['auto', 'carro'] }),
          makeSynonym({
            id: '77777777-7777-4777-8777-777777777777',
            term: 'teléfono',
            synonyms: ['celular', 'móvil'],
          }),
        ]),
      ),
    });
    setSynonymService(synonymService);
    setDocumentService(
      makeDocumentService({ listDocuments: vi.fn().mockResolvedValue(makePage([])) }),
    );
    setTenantConfigService(makeService());

    render(<ContentSection />);

    expect(await screen.findByRole('heading', { name: 'automóvil' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'teléfono' })).toBeInTheDocument();
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText('carro')).toBeInTheDocument();
    expect(screen.getByText('celular')).toBeInTheDocument();
    expect(screen.getByText('móvil')).toBeInTheDocument();
  });

  it('valida el término obligatorio sin llamar al servicio', async () => {
    const synonymService = makeSynonymService();
    setSynonymService(synonymService);
    setDocumentService(
      makeDocumentService({ listDocuments: vi.fn().mockResolvedValue(makePage([])) }),
    );
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByRole('heading', { name: 'automóvil' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agregar sinónimo' }));
    });

    expect(await screen.findByText('El término es obligatorio.')).toBeInTheDocument();
    expect(synonymService.createSynonym).not.toHaveBeenCalled();
  });

  it('valida que se indique al menos un sinónimo', async () => {
    const synonymService = makeSynonymService();
    setSynonymService(synonymService);
    setDocumentService(
      makeDocumentService({ listDocuments: vi.fn().mockResolvedValue(makePage([])) }),
    );
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await user.type(screen.getByLabelText('Término'), 'automóvil');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agregar sinónimo' }));
    });

    expect(
      await screen.findByText('Indica al menos un sinónimo separado por comas.'),
    ).toBeInTheDocument();
    expect(synonymService.createSynonym).not.toHaveBeenCalled();
  });

  it('crea un sinónimo individual', async () => {
    const synonymService = makeSynonymService({
      listSynonyms: vi.fn().mockResolvedValue(makePage([])),
      createSynonym: vi
        .fn()
        .mockImplementation(async (input: ISynonymCreate) =>
          makeSynonym({ term: input.term, synonyms: input.synonyms }),
        ),
    });
    setSynonymService(synonymService);
    setDocumentService(
      makeDocumentService({ listDocuments: vi.fn().mockResolvedValue(makePage([])) }),
    );
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await user.type(screen.getByLabelText('Término'), 'computadora');
    await user.type(screen.getByLabelText('Sinónimos (separados por comas)'), 'pc, ordenador');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agregar sinónimo' }));
    });

    expect(synonymService.createSynonym).toHaveBeenCalledWith({
      term: 'computadora',
      synonyms: ['pc', 'ordenador'],
    });
    expect(await screen.findByText('Sinónimo creado correctamente.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'computadora' })).toBeInTheDocument();
    expect(screen.getByText('pc')).toBeInTheDocument();
    expect(screen.getByText('ordenador')).toBeInTheDocument();
  });

  it('crea múltiples sinónimos separados por comas', async () => {
    const synonymService = makeSynonymService({
      listSynonyms: vi.fn().mockResolvedValue(makePage([])),
      createSynonym: vi
        .fn()
        .mockImplementation(async (input: ISynonymCreate) =>
          makeSynonym({ term: input.term, synonyms: input.synonyms }),
        ),
    });
    setSynonymService(synonymService);
    setDocumentService(
      makeDocumentService({ listDocuments: vi.fn().mockResolvedValue(makePage([])) }),
    );
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await user.type(screen.getByLabelText('Término'), 'vehículo');
    await user.type(screen.getByLabelText('Sinónimos (separados por comas)'), 'auto, carro, coche');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Agregar sinónimo' }));
    });

    expect(synonymService.createSynonym).toHaveBeenCalledWith({
      term: 'vehículo',
      synonyms: ['auto', 'carro', 'coche'],
    });
    expect(await screen.findByText('Sinónimo creado correctamente.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'vehículo' })).toBeInTheDocument();
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText('carro')).toBeInTheDocument();
    expect(screen.getByText('coche')).toBeInTheDocument();
  });

  it('edita un sinónimo precargando el formulario', async () => {
    const synonymService = makeSynonymService({
      updateSynonym: vi
        .fn()
        .mockImplementation(async (id: string, input: ISynonymUpdate) =>
          makeSynonym({ id, ...input }),
        ),
    });
    setSynonymService(synonymService);
    setDocumentService(
      makeDocumentService({ listDocuments: vi.fn().mockResolvedValue(makePage([])) }),
    );
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByRole('heading', { name: 'automóvil' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Editar' }));
    });

    expect(screen.getByLabelText('Término')).toHaveValue('automóvil');
    expect(screen.getByLabelText('Sinónimos (separados por comas)')).toHaveValue('auto, carro');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Sinónimos (separados por comas)'));
    await user.type(screen.getByLabelText('Sinónimos (separados por comas)'), 'auto, carro, coche');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    });

    expect(synonymService.updateSynonym).toHaveBeenCalledWith(
      '66666666-6666-4666-8666-666666666666',
      { term: 'automóvil', synonyms: ['auto', 'carro', 'coche'] },
    );
    expect(await screen.findByText('Sinónimo actualizado correctamente.')).toBeInTheDocument();
    expect(screen.getByText('coche')).toBeInTheDocument();
  });

  it('elimina un sinónimo', async () => {
    const synonymService = makeSynonymService();
    setSynonymService(synonymService);
    setDocumentService(
      makeDocumentService({ listDocuments: vi.fn().mockResolvedValue(makePage([])) }),
    );
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByRole('heading', { name: 'automóvil' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    });

    expect(synonymService.deleteSynonym).toHaveBeenCalledWith(
      '66666666-6666-4666-8666-666666666666',
    );
    expect(await screen.findByText('Aún no hay sinónimos definidos.')).toBeInTheDocument();
  });

  it('valida el contenido de importación vacío', async () => {
    const synonymService = makeSynonymService();
    setSynonymService(synonymService);
    setDocumentService(
      makeDocumentService({ listDocuments: vi.fn().mockResolvedValue(makePage([])) }),
    );
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByRole('heading', { name: 'automóvil' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Importar' }));
    });

    expect(await screen.findByText('Pega el contenido CSV o JSON a importar.')).toBeInTheDocument();
    expect(synonymService.importSynonyms).not.toHaveBeenCalled();
  });

  it('importa sinónimos desde texto y muestra el resultado', async () => {
    const synonymService = makeSynonymService();
    setSynonymService(synonymService);
    setDocumentService(
      makeDocumentService({ listDocuments: vi.fn().mockResolvedValue(makePage([])) }),
    );
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await user.type(
      screen.getByLabelText('Contenido CSV o JSON (término,sinónimos)'),
      'casa, hogar|vivienda, mascota, perro',
    );
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Importar' }));
    });

    expect(synonymService.importSynonyms).toHaveBeenCalledWith({
      content: 'casa, hogar|vivienda, mascota, perro',
      format: 'csv',
    });
    expect(
      await screen.findByText('Importación completada: 2 creados, 0 omitidos, 0 con errores.'),
    ).toBeInTheDocument();
  });

  it('exporta sinónimos y descarga el archivo', async () => {
    const createObjectUrl = vi.fn().mockReturnValue('blob:mock');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const synonymService = makeSynonymService();
    setSynonymService(synonymService);
    setDocumentService(
      makeDocumentService({ listDocuments: vi.fn().mockResolvedValue(makePage([])) }),
    );
    setTenantConfigService(makeService());
    const user = userEvent.setup();

    render(<ContentSection />);

    await screen.findByRole('heading', { name: 'automóvil' });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Exportar' }));
    });

    expect(synonymService.exportSynonyms).toHaveBeenCalledWith('csv');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Archivo exportado correctamente.')).toBeInTheDocument();
  });
});
