/**
 * Pruebas del store de operación del bot (Bloque B) — contactos, plantillas, árboles,
 * campañas, destinatarios, intervenciones y mantenimiento.
 *
 * Contrato:
 * - Usa las factorías compartidas de `@/test/operationsMocks` para construir DTOs y
 *   el servicio mock (`IOperationsService`), evitando duplicación en cada prueba.
 * - Cada flujo se aísla por colección: el store mantiene estados de carga/error
 *   independientes, por lo que cada `describe` verifica solo su propia colección.
 * - `afterEach` desregistra el servicio para que las pruebas siguientes empiecen
 *   sin dependencia (estado de error estable al no haber servicio registrado).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IContactRead, IMaintenanceActionRead, IPage, IStatsOverviewRead } from '@/api/types';
import { AppError } from '@/lib/errors';
import { setOperationsService, useOperationsStore } from '@/store/operationsStore';
import type {
  ICampaignInput,
  ICampaignRecipientInput,
  IContactInput,
  IInterventionInput,
  IMaintenanceConfigInput,
  INavigationTreeInput,
  IOperationsService,
  ITemplateInput,
} from '@/services/operationsService';
import {
  makeCampaign,
  makeCampaignRecipient,
  makeContact,
  makeIntervention,
  makeMaintenanceAction,
  makeMaintenanceConfig,
  makeNavigationTree,
  makePage,
  makeScheduledRunResult,
  makeService,
  makeStatsOverview,
  makeTableStats,
  makeTemplate,
} from '@/test/operationsMocks';

describe('operationsStore', () => {
  beforeEach(() => {
    useOperationsStore.getState().reset();
  });

  afterEach(() => {
    useOperationsStore.getState().reset();
    setOperationsService(null);
  });

  it('parte del estado inicial por defecto', () => {
    const state = useOperationsStore.getState();
    expect(state.contacts).toEqual([]);
    expect(state.contactsStatus).toBe('idle');
    expect(state.contactsError).toBeNull();
    expect(state.templates).toEqual([]);
    expect(state.templatesStatus).toBe('idle');
    expect(state.templatesError).toBeNull();
    expect(state.navigationTrees).toEqual([]);
    expect(state.navigationTreesStatus).toBe('idle');
    expect(state.navigationTreesError).toBeNull();
    expect(state.campaigns).toEqual([]);
    expect(state.campaignsStatus).toBe('idle');
    expect(state.campaignsError).toBeNull();
    expect(state.campaignRecipients).toEqual([]);
    expect(state.campaignRecipientsCampaignId).toBeNull();
    expect(state.campaignRecipientsStatus).toBe('idle');
    expect(state.campaignRecipientsError).toBeNull();
    expect(state.interventions).toEqual([]);
    expect(state.interventionsStatus).toBe('idle');
    expect(state.interventionsError).toBeNull();
    expect(state.maintenanceConfig).toBeNull();
    expect(state.maintenanceStatus).toBe('idle');
    expect(state.maintenanceError).toBeNull();
    expect(state.statsOverview).toBeNull();
    expect(state.statsOverviewStatus).toBe('idle');
    expect(state.statsOverviewError).toBeNull();
    expect(state.maintenanceAction).toBeNull();
    expect(state.maintenanceActionStatus).toBe('idle');
    expect(state.maintenanceActionError).toBeNull();
  });

  describe('contactos', () => {
    it('carga el directorio de contactos del tenant', async () => {
      const listContacts = vi
        .fn<IOperationsService['listContacts']>()
        .mockResolvedValue(makePage([makeContact()]));
      setOperationsService(makeService({ listContacts }));

      await useOperationsStore.getState().listContacts();

      expect(listContacts).toHaveBeenCalledTimes(1);
      expect(useOperationsStore.getState().contacts).toEqual([makeContact()]);
      expect(useOperationsStore.getState().contactsStatus).toBe('success');
      expect(useOperationsStore.getState().contactsError).toBeNull();
    });

    it('pasa a loading mientras la carga de contactos está pendiente', async () => {
      let resolve!: (value: IPage<IContactRead>) => void;
      const listContacts = vi.fn<IOperationsService['listContacts']>().mockImplementation(
        () =>
          new Promise<IPage<IContactRead>>((res) => {
            resolve = res;
          }),
      );
      setOperationsService(makeService({ listContacts }));

      const pending = useOperationsStore.getState().listContacts();

      expect(useOperationsStore.getState().contactsStatus).toBe('loading');
      expect(useOperationsStore.getState().contactsError).toBeNull();

      resolve(makePage([makeContact()]));
      await pending;

      expect(useOperationsStore.getState().contactsStatus).toBe('success');
      expect(useOperationsStore.getState().contacts).toEqual([makeContact()]);
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useOperationsStore.getState().listContacts();

      expect(useOperationsStore.getState().contactsStatus).toBe('error');
      expect(useOperationsStore.getState().contactsError).toBe(
        'La operación del bot no está disponible.',
      );
    });

    it('propaga el mensaje de un AppError del servicio', async () => {
      const listContacts = vi.fn<IOperationsService['listContacts']>().mockRejectedValue(
        new AppError('Fallo al listar contactos', 'operations.listContacts', {
          status: 500,
        }),
      );
      setOperationsService(makeService({ listContacts }));

      await useOperationsStore.getState().listContacts();

      expect(useOperationsStore.getState().contactsStatus).toBe('error');
      expect(useOperationsStore.getState().contactsError).toBe('Fallo al listar contactos');
    });

    it('propaga el mensaje de un Error genérico del servicio', async () => {
      const listContacts = vi
        .fn<IOperationsService['listContacts']>()
        .mockRejectedValue(new Error('Red caída'));
      setOperationsService(makeService({ listContacts }));

      await useOperationsStore.getState().listContacts();

      expect(useOperationsStore.getState().contactsStatus).toBe('error');
      expect(useOperationsStore.getState().contactsError).toBe('Red caída');
    });

    it('usa un mensaje por defecto cuando el error no es una instancia de Error', async () => {
      const listContacts = vi
        .fn<IOperationsService['listContacts']>()
        .mockRejectedValue('respuesta no estructurada');
      setOperationsService(makeService({ listContacts }));

      await useOperationsStore.getState().listContacts();

      expect(useOperationsStore.getState().contactsStatus).toBe('error');
      expect(useOperationsStore.getState().contactsError).toBe(
        'No se pudieron cargar los contactos.',
      );
    });

    it('crea un contacto y lo agrega a la colección', async () => {
      const created = makeContact({
        id: '99999999-9999-4999-8999-999999999999',
      });
      const createContact = vi.fn<IOperationsService['createContact']>().mockResolvedValue(created);
      setOperationsService(makeService({ createContact }));

      const input: IContactInput = { phone: '+529999999999', name: 'Nuevo' };
      await useOperationsStore.getState().createContact(input);

      expect(createContact).toHaveBeenCalledWith(input);
      expect(useOperationsStore.getState().contacts).toEqual([created]);
      expect(useOperationsStore.getState().contactsStatus).toBe('success');
    });

    it('actualiza un contacto reemplazándolo en la colección', async () => {
      const original = makeContact();
      useOperationsStore.setState({ contacts: [original] });
      const updated = makeContact({ name: 'Nombre actualizado' });
      const updateContact = vi.fn<IOperationsService['updateContact']>().mockResolvedValue(updated);
      setOperationsService(makeService({ updateContact }));

      await useOperationsStore
        .getState()
        .updateContact(original.id, { name: 'Nombre actualizado' });

      expect(updateContact).toHaveBeenCalledWith(original.id, {
        name: 'Nombre actualizado',
      });
      expect(useOperationsStore.getState().contacts).toEqual([updated]);
      expect(useOperationsStore.getState().contactsStatus).toBe('success');
    });

    it('elimina un contacto y lo quita de la colección', async () => {
      const toRemove = makeContact();
      useOperationsStore.setState({
        contacts: [toRemove, makeContact({ id: '99999999-9999-4999-8999-999999999999' })],
      });
      const deleteContact = vi
        .fn<IOperationsService['deleteContact']>()
        .mockResolvedValue(undefined);
      setOperationsService(makeService({ deleteContact }));

      await useOperationsStore.getState().deleteContact(toRemove.id);

      expect(deleteContact).toHaveBeenCalledWith(toRemove.id);
      expect(useOperationsStore.getState().contacts).toHaveLength(1);
      expect(useOperationsStore.getState().contacts[0]?.id).not.toBe(toRemove.id);
      expect(useOperationsStore.getState().contactsStatus).toBe('success');
    });

    it('degrade a error cuando falla la creación de un contacto', async () => {
      const createContact = vi
        .fn<IOperationsService['createContact']>()
        .mockRejectedValue(new Error('Red caída'));
      setOperationsService(makeService({ createContact }));

      await useOperationsStore.getState().createContact({ phone: '+529999999999', name: 'Nuevo' });

      expect(useOperationsStore.getState().contactsStatus).toBe('error');
      expect(useOperationsStore.getState().contactsError).toBe('Red caída');
    });
  });

  describe('plantillas', () => {
    it('carga las plantillas del tenant', async () => {
      const listTemplates = vi
        .fn<IOperationsService['listTemplates']>()
        .mockResolvedValue(makePage([makeTemplate()]));
      setOperationsService(makeService({ listTemplates }));

      await useOperationsStore.getState().listTemplates();

      expect(listTemplates).toHaveBeenCalledTimes(1);
      expect(useOperationsStore.getState().templates).toEqual([makeTemplate()]);
      expect(useOperationsStore.getState().templatesStatus).toBe('success');
    });

    it('crea una plantilla y la agrega a la colección', async () => {
      const created = makeTemplate({ name: 'Nueva plantilla' });
      const createTemplate = vi
        .fn<IOperationsService['createTemplate']>()
        .mockResolvedValue(created);
      setOperationsService(makeService({ createTemplate }));

      const input: ITemplateInput = { name: 'Nueva plantilla' };
      await useOperationsStore.getState().createTemplate(input);

      expect(createTemplate).toHaveBeenCalledWith(input);
      expect(useOperationsStore.getState().templates).toEqual([created]);
    });

    it('actualiza una plantilla reemplazándola en la colección', async () => {
      const original = makeTemplate();
      useOperationsStore.setState({ templates: [original] });
      const updated = makeTemplate({ name: 'Plantilla actualizada' });
      const updateTemplate = vi
        .fn<IOperationsService['updateTemplate']>()
        .mockResolvedValue(updated);
      setOperationsService(makeService({ updateTemplate }));

      await useOperationsStore
        .getState()
        .updateTemplate(original.id, { name: 'Plantilla actualizada' });

      expect(updateTemplate).toHaveBeenCalledWith(original.id, {
        name: 'Plantilla actualizada',
      });
      expect(useOperationsStore.getState().templates).toEqual([updated]);
    });

    it('elimina una plantilla y la quita de la colección', async () => {
      const toRemove = makeTemplate();
      useOperationsStore.setState({
        templates: [toRemove, makeTemplate({ id: '99999999-9999-4999-8999-999999999999' })],
      });
      const deleteTemplate = vi
        .fn<IOperationsService['deleteTemplate']>()
        .mockResolvedValue(undefined);
      setOperationsService(makeService({ deleteTemplate }));

      await useOperationsStore.getState().deleteTemplate(toRemove.id);

      expect(deleteTemplate).toHaveBeenCalledWith(toRemove.id);
      expect(useOperationsStore.getState().templates).toHaveLength(1);
    });

    it('degrade a error cuando falla la carga de plantillas', async () => {
      const listTemplates = vi.fn<IOperationsService['listTemplates']>().mockRejectedValue('fallo');
      setOperationsService(makeService({ listTemplates }));

      await useOperationsStore.getState().listTemplates();

      expect(useOperationsStore.getState().templatesStatus).toBe('error');
      expect(useOperationsStore.getState().templatesError).toBe(
        'No se pudieron cargar las plantillas.',
      );
    });

    it('degrade a error en plantillas sin servicio registrado', async () => {
      await useOperationsStore.getState().createTemplate({ name: 'Sin servicio' });

      expect(useOperationsStore.getState().templatesStatus).toBe('error');
      expect(useOperationsStore.getState().templatesError).toBe(
        'La operación del bot no está disponible.',
      );
    });
  });

  describe('árboles', () => {
    it('carga los árboles de navegación del bot', async () => {
      const listNavigationTrees = vi
        .fn<IOperationsService['listNavigationTrees']>()
        .mockResolvedValue(makePage([makeNavigationTree()]));
      setOperationsService(makeService({ listNavigationTrees }));

      await useOperationsStore.getState().listNavigationTrees();

      expect(listNavigationTrees).toHaveBeenCalledTimes(1);
      expect(useOperationsStore.getState().navigationTrees).toEqual([makeNavigationTree()]);
      expect(useOperationsStore.getState().navigationTreesStatus).toBe('success');
    });

    it('crea un árbol de navegación y lo agrega a la colección', async () => {
      const created = makeNavigationTree({ name: 'Nuevo menú' });
      const createNavigationTree = vi
        .fn<IOperationsService['createNavigationTree']>()
        .mockResolvedValue(created);
      setOperationsService(makeService({ createNavigationTree }));

      const input: INavigationTreeInput = { name: 'Nuevo menú', numOptions: 3 };
      await useOperationsStore.getState().createNavigationTree(input);

      expect(createNavigationTree).toHaveBeenCalledWith(input);
      expect(useOperationsStore.getState().navigationTrees).toEqual([created]);
    });

    it('actualiza un árbol de navegación reemplazándolo en la colección', async () => {
      const original = makeNavigationTree();
      useOperationsStore.setState({ navigationTrees: [original] });
      const updated = makeNavigationTree({ num_options: 4 });
      const updateNavigationTree = vi
        .fn<IOperationsService['updateNavigationTree']>()
        .mockResolvedValue(updated);
      setOperationsService(makeService({ updateNavigationTree }));

      await useOperationsStore.getState().updateNavigationTree(original.id, { numOptions: 4 });

      expect(updateNavigationTree).toHaveBeenCalledWith(original.id, {
        numOptions: 4,
      });
      expect(useOperationsStore.getState().navigationTrees).toEqual([updated]);
    });

    it('elimina un árbol de navegación y lo quita de la colección', async () => {
      const toRemove = makeNavigationTree();
      useOperationsStore.setState({
        navigationTrees: [
          toRemove,
          makeNavigationTree({ id: '99999999-9999-4999-8999-999999999999' }),
        ],
      });
      const deleteNavigationTree = vi
        .fn<IOperationsService['deleteNavigationTree']>()
        .mockResolvedValue(undefined);
      setOperationsService(makeService({ deleteNavigationTree }));

      await useOperationsStore.getState().deleteNavigationTree(toRemove.id);

      expect(deleteNavigationTree).toHaveBeenCalledWith(toRemove.id);
      expect(useOperationsStore.getState().navigationTrees).toHaveLength(1);
    });

    it('degrade a error cuando falla la carga de árboles', async () => {
      const listNavigationTrees = vi
        .fn<IOperationsService['listNavigationTrees']>()
        .mockRejectedValue('fallo');
      setOperationsService(makeService({ listNavigationTrees }));

      await useOperationsStore.getState().listNavigationTrees();

      expect(useOperationsStore.getState().navigationTreesStatus).toBe('error');
      expect(useOperationsStore.getState().navigationTreesError).toBe(
        'No se pudieron cargar los árboles.',
      );
    });

    it('degrade a error en árboles sin servicio registrado', async () => {
      await useOperationsStore
        .getState()
        .createNavigationTree({ name: 'Sin servicio', numOptions: 1 });

      expect(useOperationsStore.getState().navigationTreesStatus).toBe('error');
      expect(useOperationsStore.getState().navigationTreesError).toBe(
        'La operación del bot no está disponible.',
      );
    });
  });

  describe('campañas', () => {
    it('carga las campañas de envío del tenant', async () => {
      const listCampaigns = vi
        .fn<IOperationsService['listCampaigns']>()
        .mockResolvedValue(makePage([makeCampaign()]));
      setOperationsService(makeService({ listCampaigns }));

      await useOperationsStore.getState().listCampaigns();

      expect(listCampaigns).toHaveBeenCalledTimes(1);
      expect(useOperationsStore.getState().campaigns).toEqual([makeCampaign()]);
      expect(useOperationsStore.getState().campaignsStatus).toBe('success');
    });

    it('crea una campaña y la agrega a la colección', async () => {
      const created = makeCampaign({ name: 'Nueva campaña' });
      const createCampaign = vi
        .fn<IOperationsService['createCampaign']>()
        .mockResolvedValue(created);
      setOperationsService(makeService({ createCampaign }));

      const input: ICampaignInput = { name: 'Nueva campaña' };
      await useOperationsStore.getState().createCampaign(input);

      expect(createCampaign).toHaveBeenCalledWith(input);
      expect(useOperationsStore.getState().campaigns).toEqual([created]);
    });

    it('actualiza una campaña reemplazándola en la colección', async () => {
      const original = makeCampaign();
      useOperationsStore.setState({ campaigns: [original] });
      const updated = makeCampaign({ state: 'active' });
      const updateCampaign = vi
        .fn<IOperationsService['updateCampaign']>()
        .mockResolvedValue(updated);
      setOperationsService(makeService({ updateCampaign }));

      await useOperationsStore.getState().updateCampaign(original.id, { state: 'active' });

      expect(updateCampaign).toHaveBeenCalledWith(original.id, {
        state: 'active',
      });
      expect(useOperationsStore.getState().campaigns).toEqual([updated]);
    });

    it('elimina una campaña y la quita de la colección', async () => {
      const toRemove = makeCampaign();
      useOperationsStore.setState({
        campaigns: [toRemove, makeCampaign({ id: '99999999-9999-4999-8999-999999999999' })],
      });
      const deleteCampaign = vi
        .fn<IOperationsService['deleteCampaign']>()
        .mockResolvedValue(undefined);
      setOperationsService(makeService({ deleteCampaign }));

      await useOperationsStore.getState().deleteCampaign(toRemove.id);

      expect(deleteCampaign).toHaveBeenCalledWith(toRemove.id);
      expect(useOperationsStore.getState().campaigns).toHaveLength(1);
    });

    it('degrade a error cuando falla la carga de campañas', async () => {
      const listCampaigns = vi.fn<IOperationsService['listCampaigns']>().mockRejectedValue('fallo');
      setOperationsService(makeService({ listCampaigns }));

      await useOperationsStore.getState().listCampaigns();

      expect(useOperationsStore.getState().campaignsStatus).toBe('error');
      expect(useOperationsStore.getState().campaignsError).toBe(
        'No se pudieron cargar las campañas.',
      );
    });

    it('degrade a error en campañas sin servicio registrado', async () => {
      await useOperationsStore.getState().createCampaign({ name: 'Sin servicio' });

      expect(useOperationsStore.getState().campaignsStatus).toBe('error');
      expect(useOperationsStore.getState().campaignsError).toBe(
        'La operación del bot no está disponible.',
      );
    });
  });

  describe('destinatarios', () => {
    it('carga los destinatarios de la campaña indicada', async () => {
      const listCampaignRecipients = vi
        .fn<IOperationsService['listCampaignRecipients']>()
        .mockResolvedValue(makePage([makeCampaignRecipient()]));
      setOperationsService(makeService({ listCampaignRecipients }));

      await useOperationsStore.getState().listCampaignRecipients('campaign-1');

      expect(listCampaignRecipients).toHaveBeenCalledWith('campaign-1');
      expect(useOperationsStore.getState().campaignRecipients).toEqual([makeCampaignRecipient()]);
      expect(useOperationsStore.getState().campaignRecipientsCampaignId).toBe('campaign-1');
      expect(useOperationsStore.getState().campaignRecipientsStatus).toBe('success');
    });

    it('añade un destinatario y lo agrega a la colección de la campaña', async () => {
      const recipient = makeCampaignRecipient();
      const addCampaignRecipient = vi
        .fn<IOperationsService['addCampaignRecipient']>()
        .mockResolvedValue(recipient);
      setOperationsService(makeService({ addCampaignRecipient }));

      const input: ICampaignRecipientInput = {
        contactId: '51111111-1111-4111-8111-111111111111',
      };
      await useOperationsStore.getState().addCampaignRecipient('campaign-1', input);

      expect(addCampaignRecipient).toHaveBeenCalledWith('campaign-1', input);
      expect(useOperationsStore.getState().campaignRecipients).toEqual([recipient]);
      expect(useOperationsStore.getState().campaignRecipientsCampaignId).toBe('campaign-1');
    });

    it('actualiza un destinatario reemplazándolo en la colección', async () => {
      const original = makeCampaignRecipient();
      useOperationsStore.setState({ campaignRecipients: [original] });
      const updated = makeCampaignRecipient({ state: 'sent' });
      const updateCampaignRecipient = vi
        .fn<IOperationsService['updateCampaignRecipient']>()
        .mockResolvedValue(updated);
      setOperationsService(makeService({ updateCampaignRecipient }));

      await useOperationsStore.getState().updateCampaignRecipient(original.id, { state: 'sent' });

      expect(updateCampaignRecipient).toHaveBeenCalledWith(original.id, {
        state: 'sent',
      });
      expect(useOperationsStore.getState().campaignRecipients).toEqual([updated]);
    });

    it('degrade a error cuando falla la carga de destinatarios', async () => {
      const listCampaignRecipients = vi
        .fn<IOperationsService['listCampaignRecipients']>()
        .mockRejectedValue('fallo');
      setOperationsService(makeService({ listCampaignRecipients }));

      await useOperationsStore.getState().listCampaignRecipients('campaign-1');

      expect(useOperationsStore.getState().campaignRecipientsStatus).toBe('error');
      expect(useOperationsStore.getState().campaignRecipientsError).toBe(
        'No se pudieron cargar los destinatarios.',
      );
    });

    it('degrade a error en destinatarios sin servicio registrado', async () => {
      await useOperationsStore.getState().addCampaignRecipient('campaign-1', {
        contactId: '51111111-1111-4111-8111-111111111111',
      });

      expect(useOperationsStore.getState().campaignRecipientsStatus).toBe('error');
      expect(useOperationsStore.getState().campaignRecipientsError).toBe(
        'La operación del bot no está disponible.',
      );
    });
  });

  describe('intervenciones', () => {
    it('carga la cola de intervenciones con el filtro de estado', async () => {
      const listInterventions = vi
        .fn<IOperationsService['listInterventions']>()
        .mockResolvedValue(makePage([makeIntervention()]));
      setOperationsService(makeService({ listInterventions }));

      await useOperationsStore.getState().listInterventions({ state: 'pending' });

      expect(listInterventions).toHaveBeenCalledWith({ state: 'pending' });
      expect(useOperationsStore.getState().interventions).toEqual([makeIntervention()]);
      expect(useOperationsStore.getState().interventionsStatus).toBe('success');
    });

    it('crea una intervención y la agrega a la cola', async () => {
      const intervention = makeIntervention();
      const createIntervention = vi
        .fn<IOperationsService['createIntervention']>()
        .mockResolvedValue(intervention);
      setOperationsService(makeService({ createIntervention }));

      const input: IInterventionInput = {
        conversationId: '88888888-8888-4888-8888-888888888888',
      };
      await useOperationsStore.getState().createIntervention(input);

      expect(createIntervention).toHaveBeenCalledWith(input);
      expect(useOperationsStore.getState().interventions).toEqual([intervention]);
    });

    it('actualiza una intervención reemplazándola en la cola', async () => {
      const original = makeIntervention();
      useOperationsStore.setState({ interventions: [original] });
      const updated = makeIntervention({ state: 'resolved' });
      const updateIntervention = vi
        .fn<IOperationsService['updateIntervention']>()
        .mockResolvedValue(updated);
      setOperationsService(makeService({ updateIntervention }));

      await useOperationsStore.getState().updateIntervention(original.id, { state: 'resolved' });

      expect(updateIntervention).toHaveBeenCalledWith(original.id, {
        state: 'resolved',
      });
      expect(useOperationsStore.getState().interventions).toEqual([updated]);
    });

    it('degrade a error cuando falla la carga de intervenciones', async () => {
      const listInterventions = vi
        .fn<IOperationsService['listInterventions']>()
        .mockRejectedValue('fallo');
      setOperationsService(makeService({ listInterventions }));

      await useOperationsStore.getState().listInterventions();

      expect(useOperationsStore.getState().interventionsStatus).toBe('error');
      expect(useOperationsStore.getState().interventionsError).toBe(
        'No se pudieron cargar las intervenciones.',
      );
    });

    it('degrade a error en intervenciones sin servicio registrado', async () => {
      await useOperationsStore.getState().listInterventions();

      expect(useOperationsStore.getState().interventionsStatus).toBe('error');
      expect(useOperationsStore.getState().interventionsError).toBe(
        'La operación del bot no está disponible.',
      );
    });
  });

  describe('mantenimiento', () => {
    it('carga la configuración de mantenimiento del tenant', async () => {
      const getMaintenanceConfig = vi
        .fn<IOperationsService['getMaintenanceConfig']>()
        .mockResolvedValue(makeMaintenanceConfig());
      setOperationsService(makeService({ getMaintenanceConfig }));

      await useOperationsStore.getState().loadMaintenanceConfig();

      expect(getMaintenanceConfig).toHaveBeenCalledTimes(1);
      expect(useOperationsStore.getState().maintenanceConfig).toEqual(makeMaintenanceConfig());
      expect(useOperationsStore.getState().maintenanceStatus).toBe('success');
    });

    it('mantiene la configuración en null cuando aún no existe (404 → null)', async () => {
      const getMaintenanceConfig = vi
        .fn<IOperationsService['getMaintenanceConfig']>()
        .mockResolvedValue(null);
      setOperationsService(makeService({ getMaintenanceConfig }));

      await useOperationsStore.getState().loadMaintenanceConfig();

      expect(useOperationsStore.getState().maintenanceConfig).toBeNull();
      expect(useOperationsStore.getState().maintenanceStatus).toBe('success');
    });

    it('guarda la configuración de mantenimiento y la materializa', async () => {
      const config = makeMaintenanceConfig({
        retention_rules: { conversations: 60 },
        maintenance_schedule: '0 4 * * *',
      });
      const upsertMaintenanceConfig = vi
        .fn<IOperationsService['upsertMaintenanceConfig']>()
        .mockResolvedValue(config);
      setOperationsService(makeService({ upsertMaintenanceConfig }));

      const input: IMaintenanceConfigInput = {
        retentionRules: { conversations: 60 },
        maintenanceSchedule: '0 4 * * *',
      };
      await useOperationsStore.getState().upsertMaintenanceConfig(input);

      expect(upsertMaintenanceConfig).toHaveBeenCalledWith(input);
      expect(useOperationsStore.getState().maintenanceConfig).toEqual(config);
      expect(useOperationsStore.getState().maintenanceStatus).toBe('success');
    });

    it('degrade a error cuando falla la carga de mantenimiento', async () => {
      const getMaintenanceConfig = vi
        .fn<IOperationsService['getMaintenanceConfig']>()
        .mockRejectedValue('fallo');
      setOperationsService(makeService({ getMaintenanceConfig }));

      await useOperationsStore.getState().loadMaintenanceConfig();

      expect(useOperationsStore.getState().maintenanceStatus).toBe('error');
      expect(useOperationsStore.getState().maintenanceError).toBe(
        'No se pudo cargar el mantenimiento.',
      );
    });

    it('degrade a error en mantenimiento sin servicio registrado', async () => {
      await useOperationsStore.getState().loadMaintenanceConfig();

      expect(useOperationsStore.getState().maintenanceStatus).toBe('error');
      expect(useOperationsStore.getState().maintenanceError).toBe(
        'La operación del bot no está disponible.',
      );
    });
  });

  describe('statsOverview', () => {
    it('carga el resumen operativo del tenant', async () => {
      const statsOverview = makeStatsOverview();
      const getStatsOverview = vi
        .fn<IOperationsService['getStatsOverview']>()
        .mockResolvedValue(statsOverview);
      setOperationsService(makeService({ getStatsOverview }));

      await useOperationsStore.getState().loadStatsOverview();

      expect(getStatsOverview).toHaveBeenCalledTimes(1);
      expect(useOperationsStore.getState().statsOverview).toEqual(statsOverview);
      expect(useOperationsStore.getState().statsOverviewStatus).toBe('success');
      expect(useOperationsStore.getState().statsOverviewError).toBeNull();
    });

    it('pasa a loading mientras el resumen está pendiente', async () => {
      let resolve!: (value: IStatsOverviewRead) => void;
      const getStatsOverview = vi
        .fn<IOperationsService['getStatsOverview']>()
        .mockImplementation(() => new Promise<IStatsOverviewRead>((res) => (resolve = res)));
      setOperationsService(makeService({ getStatsOverview }));

      const pending = useOperationsStore.getState().loadStatsOverview();
      expect(useOperationsStore.getState().statsOverviewStatus).toBe('loading');
      resolve(makeStatsOverview());
      await pending;
      expect(useOperationsStore.getState().statsOverviewStatus).toBe('success');
      expect(useOperationsStore.getState().statsOverview).toEqual(makeStatsOverview());
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useOperationsStore.getState().loadStatsOverview();

      expect(useOperationsStore.getState().statsOverviewStatus).toBe('error');
      expect(useOperationsStore.getState().statsOverviewError).toBe(
        'La operación del bot no está disponible.',
      );
    });

    it('propaga el mensaje de un AppError del servicio', async () => {
      const getStatsOverview = vi
        .fn<IOperationsService['getStatsOverview']>()
        .mockRejectedValue(
          new AppError('Fallo de resumen', 'operations.stats.overview', { status: 500 }),
        );
      setOperationsService(makeService({ getStatsOverview }));

      await useOperationsStore.getState().loadStatsOverview();

      expect(useOperationsStore.getState().statsOverviewStatus).toBe('error');
      expect(useOperationsStore.getState().statsOverviewError).toBe('Fallo de resumen');
    });

    it('usa un mensaje por defecto cuando falla la carga del resumen', async () => {
      const getStatsOverview = vi
        .fn<IOperationsService['getStatsOverview']>()
        .mockRejectedValue('fallo');
      setOperationsService(makeService({ getStatsOverview }));

      await useOperationsStore.getState().loadStatsOverview();

      expect(useOperationsStore.getState().statsOverviewStatus).toBe('error');
      expect(useOperationsStore.getState().statsOverviewError).toBe(
        'No se pudo cargar el resumen operativo.',
      );
    });
  });

  describe('maintenanceAction', () => {
    it('ejecuta la purga y materializa el resultado', async () => {
      const action = makeMaintenanceAction({ deleted_conversations: 3 });
      const purgeMaintenance = vi
        .fn<IOperationsService['purgeMaintenance']>()
        .mockResolvedValue(action);
      setOperationsService(makeService({ purgeMaintenance }));

      await useOperationsStore.getState().purgeMaintenance({ scope: 'conversations' });

      expect(purgeMaintenance).toHaveBeenCalledTimes(1);
      expect(useOperationsStore.getState().maintenanceAction).toEqual(action);
      expect(useOperationsStore.getState().maintenanceActionStatus).toBe('success');
      expect(useOperationsStore.getState().maintenanceActionError).toBeNull();
    });

    it('ejecuta la optimización y materializa el resultado', async () => {
      const action = makeMaintenanceAction({ action: 'optimize', duration_ms: 8 });
      const optimizeMaintenance = vi
        .fn<IOperationsService['optimizeMaintenance']>()
        .mockResolvedValue(action);
      setOperationsService(makeService({ optimizeMaintenance }));

      await useOperationsStore.getState().optimizeMaintenance();

      expect(optimizeMaintenance).toHaveBeenCalledTimes(1);
      expect(useOperationsStore.getState().maintenanceAction).toEqual(action);
      expect(useOperationsStore.getState().maintenanceActionStatus).toBe('success');
      expect(useOperationsStore.getState().maintenanceActionError).toBeNull();
    });

    it('pasa a loading mientras la acción está pendiente', async () => {
      let resolve!: (value: IMaintenanceActionRead) => void;
      const purgeMaintenance = vi
        .fn<IOperationsService['purgeMaintenance']>()
        .mockImplementation(() => new Promise<IMaintenanceActionRead>((res) => (resolve = res)));
      setOperationsService(makeService({ purgeMaintenance }));

      const pending = useOperationsStore.getState().purgeMaintenance({ scope: 'conversations' });
      expect(useOperationsStore.getState().maintenanceActionStatus).toBe('loading');
      resolve(makeMaintenanceAction());
      await pending;
      expect(useOperationsStore.getState().maintenanceActionStatus).toBe('success');
      expect(useOperationsStore.getState().maintenanceAction).toEqual(makeMaintenanceAction());
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useOperationsStore.getState().purgeMaintenance({ scope: 'conversations' });

      expect(useOperationsStore.getState().maintenanceActionStatus).toBe('error');
      expect(useOperationsStore.getState().maintenanceActionError).toBe(
        'La operación del bot no está disponible.',
      );
    });

    it('propaga el mensaje de un AppError del servicio', async () => {
      const optimizeMaintenance = vi
        .fn<IOperationsService['optimizeMaintenance']>()
        .mockRejectedValue(
          new AppError('Fallo de optimización', 'operations.maintenance.optimize', {
            status: 500,
          }),
        );
      setOperationsService(makeService({ optimizeMaintenance }));

      await useOperationsStore.getState().optimizeMaintenance();

      expect(useOperationsStore.getState().maintenanceActionStatus).toBe('error');
      expect(useOperationsStore.getState().maintenanceActionError).toBe('Fallo de optimización');
    });

    it('usa un mensaje por defecto cuando falla la purga', async () => {
      const purgeMaintenance = vi
        .fn<IOperationsService['purgeMaintenance']>()
        .mockRejectedValue('fallo');
      setOperationsService(makeService({ purgeMaintenance }));

      await useOperationsStore.getState().purgeMaintenance({ scope: 'conversations' });

      expect(useOperationsStore.getState().maintenanceActionStatus).toBe('error');
      expect(useOperationsStore.getState().maintenanceActionError).toBe(
        'No se pudo ejecutar la purga.',
      );
    });
  });

  describe('tableStats', () => {
    it('carga las métricas por tabla del tenant', async () => {
      const tableStats = [makeTableStats(), makeTableStats({ table_name: 'bot_conversations' })];
      const getTableStats = vi
        .fn<IOperationsService['getTableStats']>()
        .mockResolvedValue(tableStats);
      setOperationsService(makeService({ getTableStats }));

      await useOperationsStore.getState().loadTableStats();

      expect(useOperationsStore.getState().tableStats).toEqual(tableStats);
      expect(useOperationsStore.getState().tableStatsStatus).toBe('success');
      expect(useOperationsStore.getState().tableStatsError).toBeNull();
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useOperationsStore.getState().loadTableStats();

      expect(useOperationsStore.getState().tableStats).toEqual([]);
      expect(useOperationsStore.getState().tableStatsStatus).toBe('error');
      expect(useOperationsStore.getState().tableStatsError).toBe(
        'La operación del bot no está disponible.',
      );
    });

    it('degrade a error cuando el servicio falla', async () => {
      const getTableStats = vi.fn<IOperationsService['getTableStats']>().mockRejectedValue('fallo');
      setOperationsService(makeService({ getTableStats }));

      await useOperationsStore.getState().loadTableStats();

      expect(useOperationsStore.getState().tableStatsStatus).toBe('error');
      expect(useOperationsStore.getState().tableStatsError).toBe(
        'No se pudieron cargar las métricas por tabla.',
      );
    });
  });

  describe('scheduledRun', () => {
    it('ejecuta el mantenimiento programado y materializa el resultado', async () => {
      const result = makeScheduledRunResult();
      const runScheduledMaintenance = vi
        .fn<IOperationsService['runScheduledMaintenance']>()
        .mockResolvedValue(result);
      setOperationsService(makeService({ runScheduledMaintenance }));

      await useOperationsStore.getState().runScheduledMaintenance();

      expect(useOperationsStore.getState().scheduledRunResult).toEqual(result);
      expect(useOperationsStore.getState().scheduledRunStatus).toBe('success');
      expect(useOperationsStore.getState().scheduledRunError).toBeNull();
    });

    it('degrade a error cuando no hay servicio registrado', async () => {
      await useOperationsStore.getState().runScheduledMaintenance();

      expect(useOperationsStore.getState().scheduledRunResult).toBeNull();
      expect(useOperationsStore.getState().scheduledRunStatus).toBe('error');
      expect(useOperationsStore.getState().scheduledRunError).toBe(
        'La operación del bot no está disponible.',
      );
    });

    it('degrade a error cuando el servicio falla', async () => {
      const runScheduledMaintenance = vi
        .fn<IOperationsService['runScheduledMaintenance']>()
        .mockRejectedValue('fallo');
      setOperationsService(makeService({ runScheduledMaintenance }));

      await useOperationsStore.getState().runScheduledMaintenance();

      expect(useOperationsStore.getState().scheduledRunStatus).toBe('error');
      expect(useOperationsStore.getState().scheduledRunError).toBe(
        'No se pudo ejecutar el mantenimiento programado.',
      );
    });
  });

  it('reset descarta el estado y vuelve al inicial por defecto', () => {
    useOperationsStore.setState({
      contacts: [makeContact()],
      contactsStatus: 'success',
      contactsError: 'error residual',
      templates: [makeTemplate()],
      templatesStatus: 'error',
      templatesError: 'error residual',
      navigationTrees: [makeNavigationTree()],
      navigationTreesStatus: 'success',
      navigationTreesError: 'error residual',
      campaigns: [makeCampaign()],
      campaignsStatus: 'success',
      campaignsError: 'error residual',
      campaignRecipients: [makeCampaignRecipient()],
      campaignRecipientsCampaignId: 'campaign-1',
      campaignRecipientsStatus: 'success',
      campaignRecipientsError: 'error residual',
      interventions: [makeIntervention()],
      interventionsStatus: 'success',
      interventionsError: 'error residual',
      maintenanceConfig: makeMaintenanceConfig(),
      maintenanceStatus: 'success',
      maintenanceError: 'error residual',
      statsOverview: makeStatsOverview(),
      statsOverviewStatus: 'success',
      statsOverviewError: 'error residual',
      maintenanceAction: makeMaintenanceAction(),
      maintenanceActionStatus: 'success',
      maintenanceActionError: 'error residual',
      tableStats: [makeTableStats()],
      tableStatsStatus: 'success',
      tableStatsError: 'error residual',
      scheduledRunResult: makeScheduledRunResult(),
      scheduledRunStatus: 'success',
      scheduledRunError: 'error residual',
    });

    useOperationsStore.getState().reset();

    const state = useOperationsStore.getState();
    expect(state.contacts).toEqual([]);
    expect(state.contactsStatus).toBe('idle');
    expect(state.contactsError).toBeNull();
    expect(state.templates).toEqual([]);
    expect(state.templatesStatus).toBe('idle');
    expect(state.templatesError).toBeNull();
    expect(state.navigationTrees).toEqual([]);
    expect(state.navigationTreesStatus).toBe('idle');
    expect(state.navigationTreesError).toBeNull();
    expect(state.campaigns).toEqual([]);
    expect(state.campaignsStatus).toBe('idle');
    expect(state.campaignsError).toBeNull();
    expect(state.campaignRecipients).toEqual([]);
    expect(state.campaignRecipientsCampaignId).toBeNull();
    expect(state.campaignRecipientsStatus).toBe('idle');
    expect(state.campaignRecipientsError).toBeNull();
    expect(state.interventions).toEqual([]);
    expect(state.interventionsStatus).toBe('idle');
    expect(state.interventionsError).toBeNull();
    expect(state.maintenanceConfig).toBeNull();
    expect(state.maintenanceStatus).toBe('idle');
    expect(state.maintenanceError).toBeNull();
    expect(state.statsOverview).toBeNull();
    expect(state.statsOverviewStatus).toBe('idle');
    expect(state.statsOverviewError).toBeNull();
    expect(state.maintenanceAction).toBeNull();
    expect(state.maintenanceActionStatus).toBe('idle');
    expect(state.maintenanceActionError).toBeNull();
    expect(state.tableStats).toEqual([]);
    expect(state.tableStatsStatus).toBe('idle');
    expect(state.tableStatsError).toBeNull();
    expect(state.scheduledRunResult).toBeNull();
    expect(state.scheduledRunStatus).toBe('idle');
    expect(state.scheduledRunError).toBeNull();
  });
});
