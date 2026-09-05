import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Badge, Button, EmptyState, ErrorState, Input, Modal, Toast } from '.';

describe('Librería de componentes compartidos (ui)', () => {
  describe('Button', () => {
    it('renderiza la variante primaria por defecto con type button', () => {
      render(<Button>Crear contacto</Button>);
      const button = screen.getByRole('button', { name: 'Crear contacto' });
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveClass('bg-brand-600');
    });

    it('muestra Cargando… y deshabilita durante la carga', () => {
      render(<Button loading>Crear contacto</Button>);
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Cargando…');
    });

    it('soporta las variantes secondary, danger y tab', () => {
      const { rerender } = render(<Button variant="secondary">Cancelar</Button>);
      expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveClass('border-slate-300');
      rerender(<Button variant="danger">Eliminar</Button>);
      expect(screen.getByRole('button', { name: 'Eliminar' })).toHaveClass('text-red-600');
      rerender(
        <Button variant="tab" className="rounded bg-slate-100 px-3" aria-pressed>
          Tareas
        </Button>,
      );
      const tab = screen.getByRole('button', { name: 'Tareas' });
      expect(tab).toHaveClass('bg-slate-100');
      expect(tab).toHaveAttribute('aria-pressed', 'true');
    });

    it('aplica el tamaño sm para acciones compactas', () => {
      render(
        <Button variant="secondary" size="sm">
          Editar
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Editar' });
      expect(button).toHaveClass('px-3', 'py-1', 'text-xs');
    });
  });

  describe('Input', () => {
    it('asocia la etiqueta con el campo vía id', () => {
      render(<Input label="Teléfono" />);
      expect(screen.getByLabelText('Teléfono')).toBeInTheDocument();
    });

    it('marca los campos obligatorios con * y aria-required fuera del label', () => {
      render(<Input label="Teléfono" required />);
      expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
      const input = screen.getByLabelText('Teléfono');
      expect(input).toHaveAttribute('aria-required', 'true');
      // El accessible name del campo se conserva exacto (sin el *).
      expect(screen.getByRole('textbox', { name: 'Teléfono' })).toBe(input);
    });

    it('muestra el error con aria-invalid y aria-describedby', () => {
      render(<Input label="Teléfono" error="El teléfono es obligatorio." />);
      const input = screen.getByLabelText('Teléfono');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription('El teléfono es obligatorio.');
      expect(screen.getByRole('status')).toHaveTextContent('El teléfono es obligatorio.');
    });

    it('muestra la ayuda accesible vía hint', () => {
      render(<Input label="Correo" hint="Solo correos corporativos" />);
      const input = screen.getByLabelText('Correo');
      expect(input).toHaveAccessibleDescription('Solo correos corporativos');
    });
  });

  describe('Badge', () => {
    it('aplica el tono indicado', () => {
      render(<Badge tone="sky">25%</Badge>);
      expect(screen.getByText('25%')).toHaveClass('bg-sky-100', 'text-sky-700');
    });

    it('sin tono no aplica colores y permite inyectarlos vía className (SLA)', () => {
      render(
        <Badge className="bg-green-100 text-green-700" mono>
          SLA al día
        </Badge>,
      );
      expect(screen.getByText('SLA al día')).toHaveClass(
        'bg-green-100',
        'text-green-700',
        'font-mono',
      );
    });
  });

  describe('EmptyState', () => {
    it('muestra el título con role status y dispara el CTA', () => {
      const onAction = vi.fn();
      render(
        <EmptyState
          title="Aún no hay contactos en el directorio."
          actionLabel="Crear contacto"
          onAction={onAction}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        'Aún no hay contactos en el directorio.',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }));
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('ErrorState', () => {
    it('muestra mensaje, detalle técnico y botón Reintentar', () => {
      const onRetry = vi.fn();
      render(
        <ErrorState message="No se pudieron cargar los contactos." detail="x" onRetry={onRetry} />,
      );
      expect(screen.getByText('No se pudieron cargar los contactos.')).toBeInTheDocument();
      expect(screen.getByText('Ver detalle técnico')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('Modal', () => {
    it('no renderiza nada cuando está cerrado', () => {
      const { container } = render(
        <Modal open={false} onClose={() => undefined} title="Detalle">
          contenido
        </Modal>,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it('muestra el diálogo con título y cierra con Escape', () => {
      const onClose = vi.fn();
      render(
        <Modal open onClose={onClose} title="Detalle">
          contenido
        </Modal>,
      );
      expect(screen.getByRole('dialog', { name: 'Detalle' })).toHaveAttribute('aria-modal', 'true');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Toast', () => {
    it('no renderiza nada cuando está vacío', () => {
      const { container } = render(<Toast items={[]} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('muestra las notificaciones en una región aria-live', () => {
      render(<Toast items={[{ id: '1', tone: 'success', message: 'Contacto creado' }]} />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByText('Contacto creado')).toBeInTheDocument();
    });
  });
});
