import { BadRequestException } from '@nestjs/common';

// fs.promises.readFile is called by the download handler. Mock it BEFORE importing
// the controller so the module-load registers the mocked binding.
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

import { promises as fs } from 'fs';
import { WpAttachmentsController } from './wp-attachments.controller.js';

describe('WpAttachmentsController', () => {
  let mockService: {
    list: jest.Mock;
    upload: jest.Mock;
    getDownload: jest.Mock;
    softDelete: jest.Mock;
  };
  let controller: WpAttachmentsController;

  function req(userId = 'u1', role: string | undefined = 'Member'): never {
    return { user: { userId, role } } as never;
  }

  beforeEach(() => {
    mockService = {
      list: jest.fn(),
      upload: jest.fn(),
      getDownload: jest.fn(),
      softDelete: jest.fn(),
    };
    (fs.readFile as jest.Mock).mockReset();
    controller = new WpAttachmentsController(mockService as never);
  });

  it('list forwards (wpId, userId, role)', async () => {
    mockService.list.mockResolvedValue([{ id: 'a1' }]);
    expect(await controller.list('wp1', req('u1', 'Member'))).toEqual([{ id: 'a1' }]);
    expect(mockService.list).toHaveBeenCalledWith('wp1', 'u1', 'Member');
  });

  it('list defaults userId to "" + role to undefined when req.user is missing', async () => {
    mockService.list.mockResolvedValue([]);
    await controller.list('wp1', {} as never);
    expect(mockService.list).toHaveBeenCalledWith('wp1', '', undefined);
  });

  describe('upload', () => {
    it('throws BadRequestException when no file', async () => {
      await expect(
        controller.upload('wp1', undefined as never, req()),
      ).rejects.toThrow(BadRequestException);
    });

    it('forwards file metadata + caller info', async () => {
      mockService.upload.mockResolvedValue({ id: 'a1' });
      const file = {
        buffer: Buffer.from('data'),
        originalname: 'doc.pdf',
        mimetype: 'application/pdf',
        size: 4,
      } as never;
      await controller.upload('wp1', file, req('pm1', 'ProjectManager'));
      expect(mockService.upload).toHaveBeenCalledWith('wp1', 'pm1', 'ProjectManager', {
        buffer: Buffer.from('data'),
        originalname: 'doc.pdf',
        mimetype: 'application/pdf',
        size: 4,
      });
    });
  });

  describe('download', () => {
    it('streams the file with the right headers', async () => {
      mockService.getDownload.mockResolvedValue({
        absolutePath: '/abs/file.pdf',
        contentType: 'application/pdf',
        fileName: 'rapport final.pdf',
      });
      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('PDF-bytes'));
      const setHeader = jest.fn();
      const end = jest.fn();
      const res = { setHeader, end } as never;

      await controller.download('a1', req('u1', 'Admin'), res);
      expect(mockService.getDownload).toHaveBeenCalledWith('a1', 'u1', 'Admin');
      expect(fs.readFile).toHaveBeenCalledWith('/abs/file.pdf');
      const headerCalls = setHeader.mock.calls;
      const types = Object.fromEntries(headerCalls.map((c) => [c[0], c[1]]));
      expect(types['Content-Type']).toBe('application/pdf');
      expect(types['Content-Disposition']).toContain('rapport%20final.pdf');
      expect(types['Content-Length']).toBe(String(Buffer.from('PDF-bytes').length));
      expect(end).toHaveBeenCalled();
    });
  });

  it('remove returns {success:true} after softDelete', async () => {
    mockService.softDelete.mockResolvedValue(undefined);
    const out = await controller.remove('a1', req('u1', 'Member'));
    expect(out).toEqual({ success: true });
    expect(mockService.softDelete).toHaveBeenCalledWith('a1', 'u1', 'Member');
  });
});
