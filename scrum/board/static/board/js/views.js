(function ($, Backbone, _, app) {

  var TemplateView = Backbone.View.extend({
    templateName: '',
    initialize: function () {
      this.template = _.template($(this.templateName).html());
    },
    render: function () {
      var context = this.getContext(),
        html = this.template(context);
      this.$el.html(html);
    },
    getContext: function () {
      return {};
    }
  });

  var FormView = TemplateView.extend({
    events: {
      'submit form': 'submit',
      'click button.cancel': 'done'
    },
    errorTemplate: _.template('<span class="error"><%- msg %></span>'),
    clearErrors: function () {
      $('.error', this.form).remove();
    },
    showErrors: function (errors) {
      // Show the errors from the response
      _.map(errors, function (fieldErrors, name) {
        var field = $(':input[name=' + name + ']', this.form),
          label = $('label[for=' + field.attr('id') + ']', this.form);
        if (label.length === 0) {
          label = $('label', this.form).first();
        }
        function appendError(msg) {
          label.before(this.errorTemplate({msg: msg}));
        }
        _.map(fieldErrors, appendError, this);
      }, this);
    },
    serializeForm: function (form) {
      return _.object(_.map(form.serializeArray(), function (item) {
        // Convert object to tuple of (name, value)
        return [item.name, item.value];
      }));
    },
    submit: function (event) {
      event.preventDefault();
      this.form = $(event.currentTarget);
      this.clearErrors();
    },
    failure: function (xhr, status, error) {
      var errors = xhr.responseJSON;
      this.showErrors(errors);
    },
    done: function (event) {
      if (event) {
        event.preventDefault();
      }
      this.trigger('done');
      this.remove();
    },
    modelFailure: function (model, xhr, options) {
      var errors = xhr.responseJSON;
      this.showErrors(errors);
    }
  });

  var HeaderView = TemplateView.extend({
    tagName: 'header',
    templateName: '#header-template',
    events: {
      'click a.logout': 'logout'
    },
    getContext: function () {
      return {authenticated: app.session.authenticated()};
    },
    logout: function (event) {
      event.preventDefault();
      app.session.delete();
      window.location = '/';
    }
  });

  var HomepageView = TemplateView.extend({
      templateName: '#home-template',
      events: {
        'click button.add': 'renderAddForm'
      },
      initialize: function (options) {
        var self = this;
        TemplateView.prototype.initialize.apply(this, arguments);
        app.collections.ready.done(function () {
          var end = new Date();
          end.setDate(end.getDate() - 7);
          end = end.toISOString().replace(/T.*/g, '');
          app.sprints.fetch({
            data: {end_min: end},
            success: $.proxy(self.render, self)
          });
        });
      },
      getContext: function () {
        return {sprints: app.sprints || null};
      },
      renderAddForm: function (event) {
        var view = new NewSprintView(),
          link = $(event.currentTarget);
        event.preventDefault();
        link.before(view.el);
        link.hide();
        view.render();
        view.on('done', function () {
          link.show();
        });
      }
  });

  var LoginView = FormView.extend({
    id: 'login',
    templateName: '#login-template',
    submit: function (event) {
      var data = {};
      FormView.prototype.submit.apply(this, arguments);
      data = this.serializeForm(this.form);
      $.post(app.apiLogin, data)
        .success($.proxy(this.loginSuccess, this))
        .fail($.proxy(this.failure, this));
    },
    loginSuccess: function (data) {
      app.session.save(data.token);
      this.done();
    }
  });

  var StatusView = TemplateView.extend({
    tagName: 'section',
    className: 'status',
    templateName: '#status-template',
    events: {
      'click button.add': 'renderAddForm'
    },
    initialize: function (options) {
      TemplateView.prototype.initialize.apply(this, arguments);
      this.sprint = options.sprint;
      this.status = options.status;
      this.title = options.title;
    },
    getContext: function () {
      return {sprint: this.sprint, title: this.title};
    },
    renderAddForm: function (event) {
      var view = new AddTaskView(),
        link = $(event.currentTarget);
      event.preventDefault();
      link.before(view.el);
      link.hide();
      view.render();
      view.on('done', function () {
        link.show();
      });
    },
    addTask: function (view) {
      $('.list', this.$el).append(view.el);
    }
  });

  var SprintView = TemplateView.extend({
    templateName: '#sprint-template',
    initialize: function (options) {
      var self = this;
      TemplateView.prototype.initialize.apply(this, arguments);
      this.sprintId = options.sprintId;
      this.sprint = null;
      this.tasks = {};
      this.statuses = {
        unassigned: new StatusView({
          sprint: null, status: 1, title: 'Backlog' }),
        todo: new StatusView({
          sprint: this.sprintId, status: 1, title: 'Not Started' }),
        active: new StatusView({
          sprint: this.sprintId, status: 2, title: 'In Development' }),
        testing: new StatusView({
          sprint: this.sprintId, status: 3, title: 'In testing.' }),
        done: new StatusView({
          sprint: this.sprintId, status: 4, title: 'Completed.' }),
      };
      app.collections.ready.done(function () {
        app.tasks.on('add', self.addTask, self);
        // self.sprint = app.sprints.push({id: self.sprintId});
        // self.sprint.fetch({
        //   success: function () {
        app.sprints.getOrFetch(self.sprintId).done(function (sprint) {
          self.sprint = sprint;
          self.render();
          // add any current tasks
          app.tasks.each(self.addTask, self);
          // fetch tasks for the current sprint
          sprint.fetchTasks();
        }).fail(function (sprint) {
          self.sprint = sprint;
          self.sprint.invalid = true;
          self.render();
        });
        // fetch unassigned tasks
        app.tasks.getBacklog();
      });
    },
    getContext: function () {
      return {sprint: this.sprint};
    },
    render: function () {
      TemplateView.prototype.render.apply(this, arguments);
      _.each(this.statuses, function (view, name){
        $('.tasks', this.$el).append(view.el);
        view.delegateEvents();
        view.render();
      }, this);
      _.each(this.tasks, function (view, taskId) {
        var task = app.task.get(taskId);
        view.remove();
        this.tasks[taskId] = this.renderTask(task);
      }, this);
    },
    addTask: function (task) {
      console.log(task);
      if (task.inBacklog() || task.inSprint(this.sprint)) {
        // this.tasks[task.get('id')] = task;
        this.tasks[task.get('id')] = this.renderTask(task);
        console.log('task added');
      }
    },
    renderTask: function (task) {
      // var column = task.statusClass(),
      //   container = this.statuses[column],
      //   html = _.template('<div><%- task.get("name") %></div>', {task: task});
      //   $('.list', container.$el).append(html);
      var view = new TaskItemView({task: task});
      _.each(this.statuses, function (container, name){
        if (container.sprint == task.get('sprint') &&
            container.status == task.get('status')) {
              container.addTask(view);
            }
      });
      view.render();
      return view;
    }
  });

  var NewSprintView = FormView.extend({
    templateName: '#new-sprint-template',
    className: 'new-sprint',
    submit: function (event) {
      var self = this,
        attributes = {};
        FormView.prototype.submit.apply(this, arguments);
        attributes = this.serializeForm(this.form);
        app.collections.ready.done(function () {
          app.sprints.create(attributes, {
            wait: true,
            success: $.proxy(self.success, self),
            error: $.proxy(self.modelFailure, self)
          });
        });
    },
    success: function (model) {
      this.done();
      window.location.hash = '#sprint/' + model.get('id');
    }
  });

  var AddTaskView = FormView.extend({
    templateName: '#new-task-template',
    submit: function (event) {
      var self = this,
        attributes = {};
      FormView.prototype.submit.apply(this, arguments);
      attributes = this.serializeForm(this.form);
      app.collections.ready.done(function () {
        app.tasks.create(attributes, {
          wait: true,
          success: $.proxy(self.success, self),
          error: $.proxy(self.modelFailure, self)
        });
      });
    },
    success: function (model, resp, options) {
      this.done();
    }
  });

  var TaskItemView = TemplateView.extend({
    tagName: 'div',
    className: 'task-item',
    templateName: '#task-item-template',
    initialize: function (options) {
      TemplateView.prototype.initialize.apply(this, arguments);
      this.task = options.task;
      this.task.on('change', this.render, this);
      this.task.on('remove', this.remove, this);
    },
    getContext: function () {
      return {task: this.task};
    },
    render: function () {
      TemplateView.prototype.render.apply(this, arguments);
      this.$el.css('order', this.task.get('order'));
    }
  });




  // var LoginView = = TemplateView.extend({
  //     id: 'login',
  //     templateName: '#login-template',
  //     errorTemplate: _.template('<span class="error"><%- msg %></span>'),
  //     events: {
  //       'submit form': 'submit'
  //     },
  //     submit: function (event) {
  //       var data = {};
  //       event.preventDefault();
  //       this.form = $(event.currentTarget);
  //       this.clearErrors();
  //       data = {
  //         username = $(':input[name="username"]', this.form).val(),
  //         password = $(':input[name="password"]', this.form).val(),
  //       };
  //       // submit login form
  //       $.post(app.apiLogin, data)
  //         .success($.proxy(this.loginSuccess, this))
  //         .fail($.proxy(this.loginFailure, this));
  //     },
  //     loginSuccess: function (data) {
  //       app.session.save(data.token);
  //       this.trigger('login', data.token);
  //     },
  //     loginFailure: function (xhr, status, error) {
  //       var errors = xhr.responseJSON;
  //       this.showErrors(errors);
  //     },
  //     showErrors: function (errors) {
  //       // Show the errors from the response
  //       _.map(errors, function (fieldErrors, name) {
  //         var field = $(':input[name=' + name + ']', this.form);
  //         label = $('label[for=' + field.attr('id') + ']', this.form);
  //         if (label.length === 0) {
  //           label = $('label', this.form).first();
  //         }
  //         function appendError(msg) {
  //           label.before(this.errorTemplate({msg: msg}));
  //         }
  //         _.map(fieldErrors, appendError, this);
  //       }, this);
  //     }
  //     clearErrors: function () {
  //       $('.error', this.form).remove();
  //     }
  // });

  app.views.HomepageView = HomepageView;
  app.views.LoginView = LoginView;
  app.views.HeaderView = HeaderView;
  app.views.SprintView = SprintView;

})(jQuery, Backbone, _, app);
